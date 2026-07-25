/**
 * MÓDULO DE GRÁFICO — NOVA
 * ===========================
 * Busca o histórico de preços e gera uma URL de gráfico via
 * QuickChart (serviço gratuito, sem necessidade de biblioteca
 * pesada de renderização no servidor).
 *
 * COMPATIBILIDADE COM O BOT: buscarHistorico(ticker) sem segundo
 * argumento continua se comportando EXATAMENTE como antes —
 * 30 dias, intervalo diário. O parâmetro "periodo" é opcional e
 * só é usado pelo site (NOVA Web), que precisa de mais opções
 * (5 dias, 6 meses, 1 ano, 5 anos).
 */

const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;

const BRAPI_BASE_URL = 'https://brapi.dev/api';
const TWELVEDATA_BASE_URL = 'https://api.twelvedata.com';

// ------------------------------------------------------------
// CONFIGURAÇÃO DE PERÍODOS
// ------------------------------------------------------------
// "1mo" é o padrão de sempre (usado pelo bot). Os demais são
// usados pelo site quando o usuário troca de período no gráfico.

const PERIODOS = {
    '5d':  { brapiRange: '5d',  brapiInterval: '1d',  tdInterval: '1day',   tdOutputsize: 5,  label: 'Últimos 5 dias' },
    '1mo': { brapiRange: '1mo', brapiInterval: '1d',  tdInterval: '1day',   tdOutputsize: 30, label: 'Últimos 30 dias' },
    '6mo': { brapiRange: '6mo', brapiInterval: '1wk', tdInterval: '1week',  tdOutputsize: 26, label: 'Últimos 6 meses' },
    '1a':  { brapiRange: '1y',  brapiInterval: '1wk', tdInterval: '1week',  tdOutputsize: 52, label: 'Último 1 ano' },
    '5a':  { brapiRange: '5y',  brapiInterval: '1mo', tdInterval: '1month', tdOutputsize: 60, label: 'Últimos 5 anos' },
};

function resolverPeriodo(periodo) {
    return PERIODOS[periodo] || PERIODOS['1mo'];
}

/**
 * Busca histórico de um ticker brasileiro (Brapi).
 */
async function buscarHistoricoBrasil(tickerSemSufixo, periodo = '1mo') {
    try {
        const cfg = resolverPeriodo(periodo);
        const url = `${BRAPI_BASE_URL}/quote/${encodeURIComponent(tickerSemSufixo)}?range=${cfg.brapiRange}&interval=${cfg.brapiInterval}&token=${BRAPI_TOKEN}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        if (!dados.results || !dados.results[0] || !dados.results[0].historicalDataPrice) {
            return { sucesso: false, erro: 'Histórico não disponível' };
        }

        const historico = dados.results[0].historicalDataPrice;

        // "datas": rótulo curto dd/mm (mantido para o gráfico do bot, QuickChart)
        const datas = historico.map((h) =>
            new Date(h.date * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        );
        // "datasISO": data COMPLETA aaaa-mm-dd (usada pelo site, sem ambiguidade de ano)
        const datasISO = historico.map((h) => new Date(h.date * 1000).toISOString().slice(0, 10));

        const precos = historico.map((h) => h.close);

        return { sucesso: true, datas, datasISO, precos };
    } catch (erro) {
        return { sucesso: false, erro: erro.message };
    }
}

/**
 * Busca histórico de um ticker global (Twelve Data).
 */
async function buscarHistoricoGlobal(ticker, periodo = '1mo') {
    try {
        const cfg = resolverPeriodo(periodo);
        const url = `${TWELVEDATA_BASE_URL}/time_series?symbol=${encodeURIComponent(ticker)}&interval=${cfg.tdInterval}&outputsize=${cfg.tdOutputsize}&apikey=${TWELVEDATA_API_KEY}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        if (dados.status === 'error' || !dados.values) {
            return { sucesso: false, erro: dados.message || 'Histórico não disponível' };
        }

        const valoresOrdenados = [...dados.values].reverse(); // API retorna do mais recente ao mais antigo

        const datas = valoresOrdenados.map((v) => {
            const d = new Date(v.datetime);
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        });
        // Twelve Data já devolve "aaaa-mm-dd" (ou "aaaa-mm-dd HH:MM:SS")
        // no campo datetime — pega só os 10 primeiros caracteres, sem
        // precisar converter nada.
        const datasISO = valoresOrdenados.map((v) => v.datetime.slice(0, 10));

        const precos = valoresOrdenados.map((v) => parseFloat(v.close));

        return { sucesso: true, datas, datasISO, precos };
    } catch (erro) {
        return { sucesso: false, erro: erro.message };
    }
}

/**
 * Ponto de entrada único: decide a fonte com base no formato do ticker.
 *
 * @param {string} ticker
 * @param {string} [periodo] - '5d' | '1mo' (padrão) | '6mo' | '1a' | '5a'
 */
async function buscarHistorico(ticker, periodo = '1mo') {
    if (ticker.toUpperCase().endsWith('.SA')) {
        const tickerSemSufixo = ticker.slice(0, -3);
        return buscarHistoricoBrasil(tickerSemSufixo, periodo);
    }
    return buscarHistoricoGlobal(ticker, periodo);
}

/**
 * Monta a URL do Yahoo Finance para o ticker.
 */
function gerarUrlYahooFinance(ticker) {
    return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`;
}

/**
 * Monta a URL do QuickChart a partir do histórico de datas/preços.
 * @param {string} [periodoLabel] - texto do período no título (padrão: "Últimos 30 dias", igual antes)
 */
function gerarUrlGrafico(ticker, datas, precos, periodoLabel = 'Últimos 30 dias') {
    const config = {
        type: 'line',
        data: {
            labels: datas,
            datasets: [
                {
                    label: ticker,
                    data: precos,
                    fill: false,
                    borderColor: 'rgb(75, 139, 235)',
                    tension: 0.1,
                },
            ],
        },
        options: {
            title: {
                display: true,
                text: `${ticker} — ${periodoLabel}`,
            },
        },
    };

    const configCodificado = encodeURIComponent(JSON.stringify(config));
    return `https://quickchart.io/chart?c=${configCodificado}&width=700&height=400`;
}

module.exports = {
    buscarHistorico,
    gerarUrlGrafico,
    gerarUrlYahooFinance,
};
