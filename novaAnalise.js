// Arquivo: novaAnalise.js — NOVA
// Comando "nova X": análise rápida de notícias de mercado para um ativo.
// Busca notícias recentes via Yahoo Finance (endpoint público, sem API
// key), identifica os termos/motivos mais mencionados nos títulos e
// monta um resumo curto com peso percentual de cada motivo.
//
// PRINCÍPIOS (mesmos do resto do NOVA):
// - Nunca recomenda compra/venda.
// - Se não achar dado, informa isso claramente — nunca inventa número.
// - Cache em arquivo .txt (JSON por dentro) para não bater na API à toa.
//
// LIMITAÇÃO CONHECIDA: a classificação de "motivos" é uma heurística
// por palavra-chave (conta menções de termos em um dicionário fixo),
// não uma análise de linguagem natural de verdade. É simples e leve
// o suficiente pra rodar no Termux, mas pode não capturar motivos
// fora do dicionário — nesse caso, ela simplesmente não aparece.

const fs = require('fs');
const path = require('path');
const mercado = require('./mercado');

const ATIVOS_MONITORADOS = ['OPENAI', 'MSFT', 'NVDA', 'GOOGL', 'HSBC'];

const CACHE_DIR = path.join(__dirname, 'cache_nova');
const CACHE_DURACAO_MS = 3 * 60 * 60 * 1000; // 3 horas

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ------------------------------------------------------------
// DICIONÁRIO DE MOTIVOS — heurística por palavra-chave (PT/EN).
// ------------------------------------------------------------
const MOTIVOS = [
    { rotulo: 'Dólar', termos: ['dollar', 'dólar', 'usd', 'currency', 'câmbio'] },
    { rotulo: 'Juros EUA', termos: ['interest rate', 'fed', 'juros', 'federal reserve', 'rate hike', 'rate cut'] },
    { rotulo: 'China - exportação', termos: ['china', 'export', 'exportação', 'tariff', 'tarifa'] },
    { rotulo: 'Resultados/Lucro', termos: ['earnings', 'profit', 'lucro', 'revenue', 'receita', 'quarterly'] },
    { rotulo: 'Regulação', termos: ['regulation', 'regulação', 'antitrust', 'lawsuit', 'processo'] },
    { rotulo: 'IA / Tecnologia', termos: ['artificial intelligence', 'inteligência artificial', 'chip', 'semiconductor'] },
    { rotulo: 'Petróleo/Energia', termos: ['oil', 'petróleo', 'energy', 'energia'] },
    { rotulo: 'Inflação', termos: ['inflation', 'inflação', 'cpi', 'ipca'] },
    { rotulo: 'Mercado geral', termos: ['market', 'mercado', 'stocks', 'ações', 'wall street'] },
];

// ------------------------------------------------------------
// CACHE — evita bater na API toda vez que alguém pede o mesmo ativo
// ------------------------------------------------------------
function caminhoCache(ativo) {
    return path.join(CACHE_DIR, `${ativo.toUpperCase()}.txt`);
}

function lerCache(ativo) {
    try {
        const p = caminhoCache(ativo);
        if (!fs.existsSync(p)) return null;
        const dados = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Date.now() - dados.timestamp > CACHE_DURACAO_MS) return null;
        return dados;
    } catch (e) {
        return null;
    }
}

function salvarCache(ativo, dados) {
    try {
        fs.writeFileSync(caminhoCache(ativo), JSON.stringify({ ...dados, timestamp: Date.now() }, null, 2), 'utf8');
    } catch (e) {
        console.error('Erro ao salvar cache NOVA:', e.message);
    }
}

// ------------------------------------------------------------
// BUSCA DE NOTÍCIAS — endpoint público de busca do Yahoo Finance,
// sem necessidade de cadastro/API key (mesmo estilo já usado em
// carteira.js para buscar preços).
// ------------------------------------------------------------
async function buscarNoticias(ativo) {
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ativo)}&newsCount=10&quotesCount=0`;
        const resposta = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const dados = await resposta.json();
        const noticias = dados.news || [];

        const seteDiasAtrasMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

        return noticias
            .filter((n) => !n.providerPublishTime || n.providerPublishTime * 1000 >= seteDiasAtrasMs)
            .slice(0, 10)
            .map((n) => ({ titulo: n.title || '', resumo: n.summary || '' }));
    } catch (e) {
        console.error(`Erro ao buscar notícias de ${ativo}:`, e.message);
        return [];
    }
}

// ------------------------------------------------------------
// CLASSIFICAÇÃO DOS MOTIVOS — conta menções, pega top 3, normaliza
// os pesos para somar exatamente 100%.
// ------------------------------------------------------------
function classificarMotivos(noticias) {
    const contagem = MOTIVOS.map((m) => ({ ...m, count: 0 }));

    noticias.forEach((n) => {
        const texto = `${n.titulo} ${n.resumo}`.toLowerCase();
        contagem.forEach((m) => {
            if (m.termos.some((termo) => texto.includes(termo))) m.count++;
        });
    });

    const top3 = contagem.filter((m) => m.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
    const totalMencoes = top3.reduce((soma, m) => soma + m.count, 0);
    if (totalMencoes === 0) return [];

    const pesos = top3.map((m) => Math.round((m.count / totalMencoes) * 100));
    const diferenca = 100 - pesos.reduce((a, b) => a + b, 0);
    if (pesos.length > 0) pesos[0] += diferenca; // corrige arredondamento

    return top3.map((m, i) => ({ rotulo: m.rotulo, peso: pesos[i] }));
}

// ------------------------------------------------------------
// VARIAÇÃO DO DIA — reaproveita mercado.js. Para ativos sem ticker
// público (ex: "OPENAI"), simplesmente não vem variação, sem quebrar.
// ------------------------------------------------------------
async function buscarVariacaoDia(ativo) {
    try {
        const cotacao = await mercado.buscarCotacao(ativo);
        if (cotacao.sucesso && typeof cotacao.variacaoPercentual === 'number') {
            return cotacao.variacaoPercentual;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ------------------------------------------------------------
// FORMATAÇÃO — máximo 5 linhas, formato fixo pedido
// ------------------------------------------------------------
function formatarResposta(ativo, variacao, motivos) {
    const sinal = variacao !== null && variacao >= 0 ? '+' : '';
    const linhaVariacao = variacao !== null
        ? `${ativo}: ${sinal}${variacao.toFixed(1)}% hoje`
        : `${ativo}: variação indisponível`;

    let texto = `${linhaVariacao}\n`;
    motivos.forEach((m, i) => {
        texto += `${i + 1}. ${m.rotulo} [${m.peso}%]\n`;
    });
    texto += motivos.length > 0
        ? `Resumo: ${motivos[0].rotulo} pesou mais.`
        : 'Resumo: sem motivo dominante identificado.';

    return texto;
}

// ------------------------------------------------------------
// PONTO DE ENTRADA — chamado pelo bot.js.
// ehComandoNova() só testa o padrão "nova X" sem fazer nada assíncrono
// (útil pro bot.js decidir rápido se deve tratar a mensagem ou não).
// processarComandoNova() faz o trabalho de verdade e retorna a string
// pronta, ou null se o texto não bater no padrão "nova X".
// ------------------------------------------------------------
function ehComandoNova(texto) {
    return /^nova\s+\S+/i.test(texto.trim());
}

async function processarComandoNova(texto) {
    const match = texto.trim().match(/^nova\s+(.+)$/i);
    if (!match) return null;

    const ativo = match[1].trim().toUpperCase();

    const cacheado = lerCache(ativo);
    if (cacheado) return cacheado.resposta;

    const noticias = await buscarNoticias(ativo);
    if (noticias.length === 0) {
        const resposta = `${ativo}: sem dados hoje`;
        salvarCache(ativo, { resposta });
        return resposta;
    }

    const motivos = classificarMotivos(noticias);
    if (motivos.length === 0) {
        const resposta = `${ativo}: sem dados hoje`;
        salvarCache(ativo, { resposta });
        return resposta;
    }

    const variacao = await buscarVariacaoDia(ativo);
    const resposta = formatarResposta(ativo, variacao, motivos);

    salvarCache(ativo, { resposta });
    return resposta;
}

module.exports = {
    processarComandoNova,
    ehComandoNova,
    ATIVOS_MONITORADOS,
};
