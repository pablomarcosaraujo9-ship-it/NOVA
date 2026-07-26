/**
 * MÓDULO DE LONGO PRAZO — NOVA
 * ===============================
 * Complementa a análise diária com contexto de 12 meses e 5 anos,
 * permitindo distinguir ruído de curto prazo de tendência estrutural.
 *
 * Usado apenas nos ativos que já apareceram no ranking do dia
 * (top 3 quedas / top 3 altas), para não estourar limite de API.
 *
 * DIAGNÓSTICO (pendência conhecida): alguns tickers brasileiros
 * (ex: RENT3.SA) às vezes voltavam "indisponível" sem explicação.
 * Agora o código:
 * 1) Repassa a mensagem de erro REAL da API (em vez de um texto
 *    genérico fixo), pra dar visibilidade da causa.
 * 2) Tenta um intervalo alternativo automaticamente se o primeiro
 *    pedido não trouxer dado (comum quando um intervalo específico
 *    não é suportado para aquele ticker).
 */

const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;

const BRAPI_BASE_URL = 'https://brapi.dev/api';
const TWELVEDATA_BASE_URL = 'https://api.twelvedata.com';

/**
 * Faz uma chamada única à Brapi para um range/interval específico
 * e calcula a variação percentual entre o primeiro e o último preço.
 * Retorna também a mensagem de erro crua da API, se houver, para
 * facilitar diagnóstico (em vez de esconder atrás de um texto genérico).
 */
async function buscarVariacaoBrasil(tickerSemSufixo, range, interval) {
    try {
        const url = `${BRAPI_BASE_URL}/quote/${encodeURIComponent(tickerSemSufixo)}?range=${range}&interval=${interval}&token=${BRAPI_TOKEN}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        const historico = dados.results?.[0]?.historicalDataPrice;

        if (!historico || historico.length < 2) {
            return {
                sucesso: false,
                erro: dados.message || dados.results?.[0]?.error || `Sem dado histórico para range=${range}/interval=${interval}`,
            };
        }

        const precoInicial = historico[0].close;
        const precoFinal = historico[historico.length - 1].close;
        const variacaoPercentual = ((precoFinal - precoInicial) / precoInicial) * 100;

        return { sucesso: true, variacaoPercentual };
    } catch (erro) {
        return { sucesso: false, erro: erro.message };
    }
}

/**
 * Faz uma chamada única à Twelve Data e calcula a variação percentual.
 */
async function buscarVariacaoGlobal(ticker, interval, outputsize) {
    try {
        const url = `${TWELVEDATA_BASE_URL}/time_series?symbol=${encodeURIComponent(ticker)}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVEDATA_API_KEY}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        if (dados.status === 'error' || !dados.values || dados.values.length < 2) {
            return {
                sucesso: false,
                erro: dados.message || `Sem dado histórico para interval=${interval}/outputsize=${outputsize}`,
            };
        }

        const valoresOrdenados = [...dados.values].reverse();
        const precoInicial = parseFloat(valoresOrdenados[0].close);
        const precoFinal = parseFloat(valoresOrdenados[valoresOrdenados.length - 1].close);
        const variacaoPercentual = ((precoFinal - precoInicial) / precoInicial) * 100;

        return { sucesso: true, variacaoPercentual };
    } catch (erro) {
        return { sucesso: false, erro: erro.message };
    }
}

/**
 * Busca variação de ~12 meses, com fallback de intervalo se o
 * primeiro pedido não trouxer dado.
 */
async function buscarVariacaoAnual(ticker) {
    const isBrasil = ticker.toUpperCase().endsWith('.SA');
    const tickerLimpo = isBrasil ? ticker.slice(0, -3) : ticker;

    if (isBrasil) {
        let resultado = await buscarVariacaoBrasil(tickerLimpo, '1y', '1mo');
        if (!resultado.sucesso) {
            console.error(`[longoPrazo] 12m falhou para ${ticker} (range=1y/interval=1mo): ${resultado.erro}. Tentando fallback...`);
            resultado = await buscarVariacaoBrasil(tickerLimpo, '1y', '1wk');
            if (!resultado.sucesso) {
                console.error(`[longoPrazo] 12m fallback também falhou para ${ticker} (interval=1wk): ${resultado.erro}`);
            }
        }
        return resultado;
    }

    let resultado = await buscarVariacaoGlobal(ticker, '1month', 13);
    if (!resultado.sucesso) {
        console.error(`[longoPrazo] 12m falhou para ${ticker} (interval=1month): ${resultado.erro}. Tentando fallback...`);
        resultado = await buscarVariacaoGlobal(ticker, '1week', 53);
        if (!resultado.sucesso) {
            console.error(`[longoPrazo] 12m fallback também falhou para ${ticker} (interval=1week): ${resultado.erro}`);
        }
    }
    return resultado;
}

/**
 * Busca variação de ~5 anos, com fallback de intervalo se o
 * primeiro pedido não trouxer dado.
 */
async function buscarVariacaoCincoAnos(ticker) {
    const isBrasil = ticker.toUpperCase().endsWith('.SA');
    const tickerLimpo = isBrasil ? ticker.slice(0, -3) : ticker;

    if (isBrasil) {
        let resultado = await buscarVariacaoBrasil(tickerLimpo, '5y', '3mo');
        if (!resultado.sucesso) {
            console.error(`[longoPrazo] 5a falhou para ${ticker} (range=5y/interval=3mo): ${resultado.erro}. Tentando fallback...`);
            resultado = await buscarVariacaoBrasil(tickerLimpo, '5y', '1mo');
            if (!resultado.sucesso) {
                console.error(`[longoPrazo] 5a fallback também falhou para ${ticker} (interval=1mo): ${resultado.erro}`);
            }
        }
        return resultado;
    }

    let resultado = await buscarVariacaoGlobal(ticker, '1month', 60);
    if (!resultado.sucesso) {
        console.error(`[longoPrazo] 5a falhou para ${ticker} (interval=1month): ${resultado.erro}. Tentando fallback...`);
        resultado = await buscarVariacaoGlobal(ticker, '1week', 260);
        if (!resultado.sucesso) {
            console.error(`[longoPrazo] 5a fallback também falhou para ${ticker} (interval=1week): ${resultado.erro}`);
        }
    }
    return resultado;
}

/**
 * Busca contexto de longo prazo (12 meses E 5 anos) para uma lista
 * de tickers, espaçando as chamadas para respeitar limites de API.
 */
async function buscarContextoLongoPrazo(tickers) {
    const resultados = [];
    for (let i = 0; i < tickers.length; i++) {
        const ticker = tickers[i];

        const variacao12m = await buscarVariacaoAnual(ticker);
        await new Promise((r) => setTimeout(r, 8000));

        const variacao5a = await buscarVariacaoCincoAnos(ticker);
        resultados.push({ ticker, variacao12m, variacao5a });

        if (i < tickers.length - 1) {
            await new Promise((r) => setTimeout(r, 8000));
        }
    }
    return resultados;
}

/**
 * Formata o contexto de longo prazo (12 meses + 5 anos) em texto
 * Markdown, de forma neutra — sem rotular como "oportunidade".
 */
function formatarContextoLongoPrazo(contextos) {
    let texto = `📅 *CONTEXTO DE LONGO PRAZO*\n───────────────────────\n`;
    texto += `Ajuda a distinguir ruído do dia de tendência estrutural. ` +
        `Avalie se a queda/alta recente reflete algo pontual ou estrutural antes de decidir.\n\n`;

    contextos.forEach((c) => {
        const fmt = (v) => {
            if (!v.sucesso) return 'indisponível';
            const sinal = v.variacaoPercentual >= 0 ? '+' : '';
            return `${sinal}${v.variacaoPercentual.toFixed(1)}%`;
        };

        texto += `\`${c.ticker}\`\n`;
        texto += `   📆 12 meses: ${fmt(c.variacao12m)}\n`;
        texto += `   📆 5 anos: ${fmt(c.variacao5a)}\n\n`;
    });

    return texto;
}

module.exports = {
    buscarVariacaoAnual,
    buscarVariacaoCincoAnos,
    buscarContextoLongoPrazo,
    formatarContextoLongoPrazo,
};
