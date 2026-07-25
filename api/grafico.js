// Arquivo: api/grafico.js — endpoint do site NOVA Web (Vercel)
//
// Reaproveita o MESMO grafico.js que o bot de Telegram usa
// (por isso o require com "../"). Recebe o ticker via query
// string (?ticker=PETR4.SA).
//
// Devolve DOIS formatos:
// - "url": imagem pronta do QuickChart (formato antigo)
// - "dados": array [{ time, value }] no formato aaaa-mm-dd,
//   SEMPRE ordenado cronologicamente e sem datas duplicadas —
//   o lightweight-charts exige ordem crescente estrita, senão
//   desenha picos/zigues errados.

const grafico = require('../grafico');

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

/**
 * Garante que o array de pontos está em ordem cronológica
 * crescente e sem datas repetidas (se houver duplicata, mantém
 * a última ocorrência — a mais "atual" na lista original).
 */
function ordenarERemoverDuplicatas(pontos) {
    const ordenados = [...pontos].sort((a, b) => a.time.localeCompare(b.time));

    const limpos = [];
    for (const ponto of ordenados) {
        const ultimo = limpos[limpos.length - 1];
        if (ultimo && ultimo.time === ponto.time) {
            limpos[limpos.length - 1] = ponto; // substitui pela versão mais recente
        } else {
            limpos.push(ponto);
        }
    }
    return limpos;
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

        const pontosBrutos = historico.datas.map((data, i) => ({
            time: paraDataISO(data),
            value: historico.precos[i],
        }));

        const dados = ordenarERemoverDuplicatas(pontosBrutos);

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
