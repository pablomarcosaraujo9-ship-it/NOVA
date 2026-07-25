// Arquivo: api/grafico.js — endpoint do site NOVA Web (Vercel)
//
// Reaproveita o MESMO grafico.js que o bot de Telegram usa
// (por isso o require com "../"). Recebe o ticker e o período
// via query string: ?ticker=PETR4.SA&periodo=5a
//
// periodo aceito: 5d | 1mo (padrão) | 6mo | 1a | 5a
//
// Devolve:
// - "url": imagem pronta do QuickChart (formato antigo)
// - "dados": array [{ time, value }] em aaaa-mm-dd — vem direto
//   de historico.datasISO (data completa, sem ambiguidade de ano),
//   ainda ordenado/deduplicado por segurança extra.

const grafico = require('../grafico');

const LABELS_PERIODO = {
    '5d': 'Últimos 5 dias',
    '1mo': 'Últimos 30 dias',
    '6mo': 'Últimos 6 meses',
    '1a': 'Último 1 ano',
    '5a': 'Últimos 5 anos',
};

function ordenarERemoverDuplicatas(pontos) {
    const ordenados = [...pontos].sort((a, b) => a.time.localeCompare(b.time));

    const limpos = [];
    for (const ponto of ordenados) {
        const ultimo = limpos[limpos.length - 1];
        if (ultimo && ultimo.time === ponto.time) {
            limpos[limpos.length - 1] = ponto;
        } else {
            limpos.push(ponto);
        }
    }
    return limpos;
}

module.exports = async (req, res) => {
    try {
        const ticker = (req.query.ticker || 'PETR4.SA').toUpperCase();
        const periodo = LABELS_PERIODO[req.query.periodo] ? req.query.periodo : '1mo';
        const periodoLabel = LABELS_PERIODO[periodo];

        const historico = await grafico.buscarHistorico(ticker, periodo);

        if (!historico.sucesso) {
            return res.status(200).json({
                texto: `⚠️ Não foi possível obter o histórico de ${ticker}: ${historico.erro}`,
            });
        }

        const urlGrafico = grafico.gerarUrlGrafico(ticker, historico.datas, historico.precos, periodoLabel);

        // Usa datasISO (data completa, sem adivinhação de ano) —
        // se por algum motivo não existir (ex: cache antigo), cai
        // para um fallback simples usando "datas" cru, sem tentar
        // converter (evita reintroduzir o bug de ano ambíguo).
        const fonteDatas = historico.datasISO || historico.datas;

        const pontosBrutos = fonteDatas.map((data, i) => ({
            time: data,
            value: historico.precos[i],
        }));

        const dados = ordenarERemoverDuplicatas(pontosBrutos);

        res.status(200).json({
            url: urlGrafico,
            dados,
            periodo,
            texto: `📈 ${ticker} — ${periodoLabel}\n\n⚠️ Movimento histórico, sem previsão de comportamento futuro.`,
        });
    } catch (error) {
        console.error('Erro no endpoint /api/grafico:', error);
        res.status(500).json({
            texto: `⚠️ Erro ao gerar gráfico: ${error.message}`,
        });
    }
};
