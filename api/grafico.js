// Arquivo: api/grafico.js — endpoint do site NOVA Web (Vercel)
//
// Reaproveita o MESMO grafico.js que o bot de Telegram usa
// (por isso o require com "../"). Recebe o ticker via query
// string (?ticker=PETR4.SA) e devolve a URL do gráfico já
// pronta, igual ao /grafico do bot.

const grafico = require('../grafico');

module.exports = async (req, res) => {
    try {
        const ticker = (req.query.ticker || 'PETR4.SA').toUpperCase();

        const historico = await grafico.buscarHistorico(ticker);

        if (!historico.sucesso) {
            return res.status(200).json({
                texto: `⚠️ Não foi possível obter o histórico de ${ticker}: ${historico.erro}`,
            });
        }

        const urlGrafico = grafico.gerarUrlGrafico(ticker, historico.datas, historico.precos);

        res.status(200).json({
            url: urlGrafico,
            texto: `📈 ${ticker} — Últimos 30 dias\n\n⚠️ Movimento histórico, sem previsão de comportamento futuro.`,
        });
    } catch (error) {
        console.error('Erro no endpoint /api/grafico:', error);
        res.status(500).json({
            texto: `⚠️ Erro ao gerar gráfico: ${error.message}`,
        });
    }
};
