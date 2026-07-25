// Arquivo: api/cotacao.js — endpoint leve do site NOVA Web (Vercel)
//
// Devolve só o preço ATUAL de um único ticker (sem histórico),
// usado pelo gráfico para simular atualização "ao vivo" via
// polling (consulta repetida a cada X segundos pelo frontend).
//
// Reaproveita mercado.buscarCotacao(), a mesma função usada
// pelo bot no /scanner.

const mercado = require('../mercado');

module.exports = async (req, res) => {
    try {
        const ticker = (req.query.ticker || 'PETR4.SA').toUpperCase();
        const cotacao = await mercado.buscarCotacao(ticker);

        if (!cotacao.sucesso) {
            return res.status(200).json({ sucesso: false, erro: cotacao.erro });
        }

        res.status(200).json({
            sucesso: true,
            ticker: cotacao.ticker,
            preco: cotacao.precoAtual,
            variacaoPercentual: cotacao.variacaoPercentual,
        });
    } catch (error) {
        console.error('Erro no endpoint /api/cotacao:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
};
