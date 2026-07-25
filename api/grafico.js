// Arquivo: api/grafico.js — endpoint do site NOVA Web (Vercel)
//
// Reaproveita o MESMO grafico.js que o bot de Telegram usa
// (por isso o require com "../"). Recebe o ticker via query
// string (?ticker=PETR4.SA).
//
// Devolve DOIS formatos, para não quebrar nada que já funciona:
// - "url": imagem pronta do QuickChart (formato antigo)
// - "dados": array [{ time, value }] cru, no formato aaaa-mm-dd
//   que o lightweight-charts exige, para o gráfico interativo

const grafico = require('../grafico');

/**
 * Converte uma data no formato "dd/mm" (como o grafico.js do bot
 * devolve) para "aaaa-mm-dd" (formato exigido pelo lightweight-charts).
 *
 * Como "dd/mm" não tem ano, assume o ano atual — e se a data
 * resultante cair no futuro (ex: hoje é janeiro e a data é
 * dezembro), assume que é do ano anterior. Isso cobre o caso de
 * uma janela de 30 dias que atravessa a virada do ano.
 */
function paraDataISO(dataBR, referencia = new Date()) {
    const [diaStr, mesStr] = dataBR.split('/');
    const dia = parseInt(diaStr, 10);
    const mes = parseInt(mesStr, 10);

    let ano = referencia.getFullYear();
    let data = new Date(ano, mes - 1, dia);

    if (data > referencia) {
        ano -= 1;
    }

    const mm = String(mes).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    return `${ano}-${mm}-${dd}`;
}

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

        const dados = historico.datas.map((data, i) => ({
            time: paraDataISO(data),
            value: historico.precos[i],
        }));

        res.status(200).json({
            url: urlGrafico,
            dados,
            texto: `📈 ${ticker} — Últimos 30 dias\n\n⚠️ Movimento histórico, sem previsão de comportamento futuro.`,
        });
    } catch (error) {
        console.error('Erro no endpoint /api/grafico:', error);
        res.status(500).json({
            texto: `⚠️ Erro ao gerar gráfico: ${error.message}`,
        });
    }
};
