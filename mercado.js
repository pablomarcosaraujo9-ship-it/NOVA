/**
 * MÓDULO DE MERCADO — NOVA
 * ==========================
 * Conecta com DUAS fontes de dados, escolhendo automaticamente
 * a fonte certa conforme o ticker:
 *
 * - Tickers terminados em ".SA" (ex: "PETR4.SA") → Brapi (Brasil/B3)
 * - Qualquer outro ticker (ex: "AAPL", "SAP.DE") → Twelve Data (Global)
 *
 * Documentação:
 * Brapi: https://brapi.dev/docs
 * Twelve Data: https://twelvedata.com/docs
 */

const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;

const BRAPI_BASE_URL = 'https://brapi.dev/api';
const TWELVEDATA_BASE_URL = 'https://api.twelvedata.com';

// ------------------------------------------------------------
// CACHE (Fase 3 do roadmap)
// ------------------------------------------------------------
// Guarda em memória o resultado da última varredura completa e
// da última cotação USD/BRL, evitando refazer todas as chamadas
// às APIs a cada /investir. Se os dados tiverem menos de 10
// minutos, reutiliza o cache; caso contrário, busca de novo.
//
// OBS: por ser em memória, o cache reseta a cada restart/deploy
// do Azure — isso é esperado e não é um bug.

const CACHE_DURACAO_MS = 10 * 60 * 1000; // 10 minutos

const cacheCotacoes = new Map(); // chave: lista de tickers ordenada -> { dados, timestamp }
let cacheUSDBRL = null; // { valor, timestamp }

function gerarChaveCacheCotacoes(tickers) {
    return tickers.slice().sort().join(',');
}

function cacheEstaValido(timestamp) {
    return timestamp && (Date.now() - timestamp) < CACHE_DURACAO_MS;
}

/**
 * Busca cotação de um ticker brasileiro via Brapi.
 * Recebe o ticker JÁ SEM o sufixo ".SA" (ex: "PETR4").
 */
async function buscarCotacaoBrasil(tickerSemSufixo) {
    try {
        const url = `${BRAPI_BASE_URL}/quote/${encodeURIComponent(tickerSemSufixo)}?token=${BRAPI_TOKEN}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        if (!dados.results || dados.results.length === 0) {
            const mensagemErro = dados.message || 'Ticker não encontrado';
            return { sucesso: false, ticker: `${tickerSemSufixo}.SA`, erro: mensagemErro };
        }

        const resultado = dados.results[0];

        return {
            sucesso: true,
            ticker: `${resultado.symbol}.SA`,
            nome: resultado.longName || resultado.shortName,
            precoAtual: resultado.regularMarketPrice,
            variacaoPercentual: resultado.regularMarketChangePercent,
            variacaoAbsoluta: resultado.regularMarketChange,
            volume: resultado.regularMarketVolume || null,
            moeda: resultado.currency || 'BRL',
            mercado: 'B3',
        };
    } catch (erro) {
        return { sucesso: false, ticker: `${tickerSemSufixo}.SA`, erro: erro.message };
    }
}

/**
 * Busca cotação de um ticker global (não-brasileiro) via Twelve Data.
 */
async function buscarCotacaoGlobal(ticker) {
    try {
        const url = `${TWELVEDATA_BASE_URL}/quote?symbol=${encodeURIComponent(ticker)}&apikey=${TWELVEDATA_API_KEY}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        if (dados.status === 'error' || dados.code) {
            return { sucesso: false, ticker, erro: dados.message || 'Erro desconhecido na API' };
        }

        return {
            sucesso: true,
            ticker: dados.symbol,
            nome: dados.name,
            precoAtual: parseFloat(dados.close),
            variacaoPercentual: parseFloat(dados.percent_change),
            variacaoAbsoluta: parseFloat(dados.change),
            volume: dados.volume ? parseInt(dados.volume) : null,
            moeda: dados.currency,
            mercado: dados.exchange,
        };
    } catch (erro) {
        return { sucesso: false, ticker, erro: erro.message };
    }
}

/**
 * NOVO — Busca a cotação atual USD/BRL via Twelve Data.
 * Usada para converter preços de ativos americanos para reais
 * antes de comparar com o orçamento do usuário (Fase 1 do roadmap).
 *
 * Retorna um número (ex: 5.42) ou lança erro se não conseguir obter.
 */
async function buscarCotacaoUSDBRL() {
    if (cacheUSDBRL && cacheEstaValido(cacheUSDBRL.timestamp)) {
        console.log(`📦 Usando cache da cotação USD/BRL (idade: ${Math.round((Date.now() - cacheUSDBRL.timestamp) / 1000)}s)`);
        return cacheUSDBRL.valor;
    }

    try {
        const url = `${TWELVEDATA_BASE_URL}/exchange_rate?symbol=USD/BRL&apikey=${TWELVEDATA_API_KEY}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        const cotacao = parseFloat(dados.rate);

        if (!cotacao || isNaN(cotacao)) {
            throw new Error(dados.message || 'Não foi possível obter a cotação USD/BRL');
        }

        cacheUSDBRL = { valor: cotacao, timestamp: Date.now() };
        return cotacao;
    } catch (erro) {
        // Repropaga o erro para quem chamou decidir como tratar
        // (ex: analise.js pode decidir abortar ou usar um valor de fallback)
        throw new Error(`Falha ao buscar cotação USD/BRL: ${erro.message}`);
    }
}

/**
 * Ponto de entrada único: decide automaticamente qual fonte usar
 * com base no formato do ticker.
 */
async function buscarCotacao(ticker) {
    if (ticker.toUpperCase().endsWith('.SA')) {
        const tickerSemSufixo = ticker.slice(0, -3); // remove ".SA"
        return buscarCotacaoBrasil(tickerSemSufixo);
    }
    return buscarCotacaoGlobal(ticker);
}

/**
 * Busca cotações de múltiplos tickers, espaçando as chamadas para
 * respeitar limites de requisições por minuto de ambas as APIs.
 */
async function buscarMultiplasCotacoes(tickers) {
    const chave = gerarChaveCacheCotacoes(tickers);
    const cacheado = cacheCotacoes.get(chave);

    if (cacheado && cacheEstaValido(cacheado.timestamp)) {
        console.log(`📦 Usando cache da varredura (idade: ${Math.round((Date.now() - cacheado.timestamp) / 1000)}s)`);
        return cacheado.dados;
    }

    const resultados = [];
    const INTERVALO_MS = 8000; // ~8s entre chamadas

    for (let i = 0; i < tickers.length; i++) {
        const cotacao = await buscarCotacao(tickers[i]);
        resultados.push(cotacao);

        if (i < tickers.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
        }
    }

    cacheCotacoes.set(chave, { dados: resultados, timestamp: Date.now() });
    return resultados;
}

/**
 * NOVO — Versão em lotes paralelos, usada pelo site (Vercel).
 * A Vercel no plano grátis corta a função em 10s, então não dá
 * pra usar o mesmo intervalo de 8s entre CADA ticker (levaria
 * uns 200s para 25 ativos). Aqui busca vários ao mesmo tempo,
 * em lotes pequenos, com uma pausa curta entre lotes — mais
 * rápido, mas ainda com algum cuidado para não estourar o limite
 * de requisições por segundo das APIs.
 *
 * NÃO é usada pelo bot.js (que continua com buscarMultiplasCotacoes,
 * sequencial) — só pelo endpoint do site.
 *
 * @param {Array} tickers
 * @param {number} tamanhoLote - quantos tickers buscar em paralelo por vez
 * @param {number} intervaloLoteMs - pausa entre lotes
 */
async function buscarMultiplasCotacoesParalelo(tickers, tamanhoLote = 5, intervaloLoteMs = 800) {
    const chave = gerarChaveCacheCotacoes(tickers);
    const cacheado = cacheCotacoes.get(chave);

    if (cacheado && cacheEstaValido(cacheado.timestamp)) {
        console.log(`📦 Usando cache da varredura - paralelo (idade: ${Math.round((Date.now() - cacheado.timestamp) / 1000)}s)`);
        return cacheado.dados;
    }

    const resultados = [];

    for (let i = 0; i < tickers.length; i += tamanhoLote) {
        const lote = tickers.slice(i, i + tamanhoLote);
        const dadosLote = await Promise.all(lote.map((ticker) => buscarCotacao(ticker)));
        resultados.push(...dadosLote);

        if (i + tamanhoLote < tickers.length) {
            await new Promise((resolve) => setTimeout(resolve, intervaloLoteMs));
        }
    }

    cacheCotacoes.set(chave, { dados: resultados, timestamp: Date.now() });
    return resultados;
}

/**
 * NOVO — Fase 4 do roadmap: versão híbrida usada pelo BOT (Telegram).
 *
 * Ativos brasileiros (Brapi) são buscados em PARALELO, em lotes
 * pequenos — a Brapi tolera isso melhor.
 * Ativos globais (Twelve Data) continuam SEQUENCIAIS, com 8s entre
 * cada um — não dá pra acelerar essa parte sem violar o limite real
 * do plano grátis da Twelve Data (8 requisições por minuto). Tentar
 * paralelizar aqui não deixaria mais rápido, só quebraria com erro
 * de limite excedido.
 *
 * As duas partes rodam ao mesmo tempo (Promise.all), então o tempo
 * total passa a ser aproximadamente o tempo da parte mais lenta
 * (os globais), não a soma das duas — corta o tempo total quase
 * pela metade em relação à versão 100% sequencial.
 */
async function buscarMultiplasCotacoesOtimizado(tickers) {
    const chave = gerarChaveCacheCotacoes(tickers);
    const cacheado = cacheCotacoes.get(chave);

    if (cacheado && cacheEstaValido(cacheado.timestamp)) {
        console.log(`📦 Usando cache da varredura - otimizado (idade: ${Math.round((Date.now() - cacheado.timestamp) / 1000)}s)`);
        return cacheado.dados;
    }

    const brasil = tickers.filter((t) => t.toUpperCase().endsWith('.SA'));
    const globais = tickers.filter((t) => !t.toUpperCase().endsWith('.SA'));

    async function buscarBrasilEmParalelo() {
        const resultados = [];
        const TAMANHO_LOTE = 5;
        const INTERVALO_LOTE_MS = 500;

        for (let i = 0; i < brasil.length; i += TAMANHO_LOTE) {
            const lote = brasil.slice(i, i + TAMANHO_LOTE);
            const dadosLote = await Promise.all(lote.map((ticker) => buscarCotacao(ticker)));
            resultados.push(...dadosLote);

            if (i + TAMANHO_LOTE < brasil.length) {
                await new Promise((resolve) => setTimeout(resolve, INTERVALO_LOTE_MS));
            }
        }
        return resultados;
    }

    async function buscarGlobaisSequencial() {
        const resultados = [];
        const INTERVALO_MS = 8000; // respeita o limite de 8 req/min da Twelve Data

        for (let i = 0; i < globais.length; i++) {
            resultados.push(await buscarCotacao(globais[i]));
            if (i < globais.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
            }
        }
        return resultados;
    }

    const [resultadosBrasil, resultadosGlobais] = await Promise.all([
        buscarBrasilEmParalelo(),
        buscarGlobaisSequencial(),
    ]);

    const resultados = [...resultadosBrasil, ...resultadosGlobais];

    cacheCotacoes.set(chave, { dados: resultados, timestamp: Date.now() });
    return resultados;
}

module.exports = {
    buscarCotacao,
    buscarMultiplasCotacoes,
    buscarMultiplasCotacoesParalelo,
    buscarMultiplasCotacoesOtimizado,
    buscarCotacaoUSDBRL,
};
