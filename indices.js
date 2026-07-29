// Arquivo: indices.js
// Busca os principais índices de mercado e o dólar

// Tickers corrigidos para evitar erro "indisponível"
// ^GSPC = S&P 500 (EUA)
// ^IXIC = Nasdaq (EUA)
// ^BVSP = Ibovespa (Brasil)
// USDBRL=X = Dólar / Real

const TICKERS_INDICES = ['^BVSP', '^GSPC', '^IXIC', 'USDBRL=X'];

const LABELS = {
    '^BVSP': 'Ibovespa',
    '^GSPC': 'S&P 500',
    '^IXIC': 'Nasdaq',
    'USDBRL=X': 'Dólar (USD/BRL)'
};

async function buscarTodosIndices() {
    const resultados = [];

    for (const ticker of TICKERS_INDICES) {
        try {
            // Usa o mesmo endpoint do mercado.js para puxar o preço
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const data = await response.json();

            let preco = null;
            let variacao = null;

            if (data.chart && data.chart.result && data.chart.result[0]) {
                const meta = data.chart.result[0].meta;
                const indicadores = data.chart.result[0].indicators;
                if (indicadores && indicadores.quote && indicadores.quote[0]) {
                    const close = indicadores.quote[0].close;
                    if (close && close.length > 0) {
                        preco = close[close.length - 1];
                        // Calcula variação baseada no preço de fechamento anterior (se disponível)
                        const previousClose = meta.previousClose;
                        if (previousClose && preco) {
                            variacao = ((preco - previousClose) / previousClose) * 100;
                        }
                    }
                }
            }

            resultados.push({
                ticker: ticker,
                label: LABELS[ticker] || ticker,
                preco: preco,
                variacaoPercentual: variacao
            });

        } catch (e) {
            // Se falhar, adiciona como indisponível
            resultados.push({
                ticker: ticker,
                label: LABELS[ticker] || ticker,
                preco: null,
                variacaoPercentual: null
            });
        }
    }

    return resultados;
}

function formatarIndices(resultados) {
    let texto = "🌎 ÍNDICES DE MERCADO\n───────────────────────\n";
    for (const item of resultados) {
        if (item.variacaoPercentual !== null) {
            const sinal = item.variacaoPercentual >= 0 ? '+' : '';
            texto += `\n${item.label}: ${sinal}${item.variacaoPercentual.toFixed(2)}%`;
        } else {
            texto += `\n${item.label}: indisponível no momento`;
        }
    }
    return texto;
}

module.exports = {
    buscarTodosIndices,
    formatarIndices
};
