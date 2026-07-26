/**
 * MÓDULO DE FUNDAMENTOS — NOVA (SCANNER)
 * ==========================================
 * Busca dados fundamentalistas REAIS (não mock) via Brapi. Disponível
 * apenas para ativos do Brasil nesta versão — não há fonte gratuita
 * confirmada de fundamentos para ativos dos EUA/globais.
 *
 * NOVOS INDICADORES (adicionados sem alterar o que já existia):
 * - Dívida Líquida/EBITDA: calculado a partir de totalDebt, totalCash
 *   e ebitda, todos já expostos pelo módulo financialData da Brapi.
 * - Lucro líquido por trimestre: tentativa via módulo
 *   incomeStatementHistoryQuarterly. Esse módulo pode não estar
 *   disponível no plano gratuito da Brapi — se não vier, o bot
 *   mostra "dado indisponível" em vez de travar ou inventar número.
 *
 * NÃO IMPLEMENTADO: percentual de receita em moeda estrangeira.
 * Não há confirmação de fonte gratuita para esse dado específico
 * (não é um campo padrão do financialData/defaultKeyStatistics).
 * Melhor não mostrar do que simular um número.
 *
 * Tudo aqui é puramente descritivo — sem "ALERTA", "BLOQUEADO" ou
 * qualquer rótulo de recomendação. Os emojis (✅/⚠️/❌) só indicam
 * o SINAL do número (positivo/neutro/negativo), não uma instrução
 * de compra ou venda.
 */

const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
const BRAPI_BASE_URL = 'https://brapi.dev/api';

/**
 * Busca fundamentos de um ticker. Retorna { disponivel: false, motivo }
 * se não for possível (ticker não-BR, dado ausente, erro de API).
 */
async function buscarFundamentos(ticker) {
    if (!ticker.toUpperCase().endsWith('.SA')) {
        return {
            disponivel: false,
            motivo: 'Fundamentos automáticos disponíveis apenas para ativos do Brasil nesta versão.',
        };
    }

    const tickerSemSufixo = ticker.slice(0, -3);

    try {
        const url = `${BRAPI_BASE_URL}/quote/${encodeURIComponent(tickerSemSufixo)}?modules=financialData,defaultKeyStatistics,incomeStatementHistoryQuarterly&token=${BRAPI_TOKEN}`;
        const resposta = await fetch(url);
        const dados = await resposta.json();

        if (!dados.results || !dados.results[0]) {
            return { disponivel: false, motivo: 'Dados fundamentalistas não retornados pela API.' };
        }

        const r = dados.results[0];
        const fd = r.financialData || {};
        const dks = r.defaultKeyStatistics || {};

        const temAlgumDado = [fd.profitMargins, fd.debtToEquity, dks.returnOnEquity].some(
            (v) => v !== undefined && v !== null
        );

        if (!temAlgumDado) {
            return {
                disponivel: false,
                motivo: 'Módulo de fundamentos retornou vazio (pode exigir plano superior da Brapi).',
            };
        }

        // --- Dívida Líquida/EBITDA (calculado, sem módulo extra) ---
        let dividaLiquidaEbitda = null;
        const totalDebt = fd.totalDebt ?? null;
        const totalCash = fd.totalCash ?? null;
        const ebitda = fd.ebitda ?? null;

        if (totalDebt !== null && ebitda !== null && ebitda !== 0) {
            const dividaLiquida = totalCash !== null ? totalDebt - totalCash : totalDebt;
            dividaLiquidaEbitda = dividaLiquida / ebitda;
        }

        // --- Lucro líquido por trimestre (best-effort — pode não vir) ---
        const historicoTrimestral = r.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
        const lucrosTrimestrais = historicoTrimestral
            .slice(0, 4)
            .map((t) => ({
                dataFim: t.endDate ? new Date(t.endDate * 1000) : null,
                lucroLiquido: t.netIncome ?? null,
            }))
            .filter((t) => t.lucroLiquido !== null && t.dataFim !== null);

        return {
            disponivel: true,
            lucroMargem: fd.profitMargins ?? null,
            dividaPatrimonio: fd.debtToEquity ?? null,
            retornoPatrimonio: fd.returnOnEquity ?? dks.returnOnEquity ?? null,
            dividaLiquidaEbitda,
            lucrosTrimestrais, // pode vir array vazio — tratado no formatador
        };
    } catch (erro) {
        return { disponivel: false, motivo: erro.message };
    }
}

/**
 * Classifica a saúde financeira com base em limiares simples,
 * sem julgamento de "comprar ou não" — só descreve o estado atual.
 * Os emojis indicam o SINAL do número, nunca uma recomendação.
 */
function classificarSaudeFinanceira(fund) {
    if (!fund.disponivel) {
        return { status: 'sem_dados', linhas: [] };
    }

    const linhas = [];
    let sinaisNegativos = 0;
    let sinaisTotal = 0;

    if (fund.lucroMargem !== null) {
        sinaisTotal++;
        if (fund.lucroMargem > 0) {
            linhas.push(`✅ Margem de lucro: ${(fund.lucroMargem * 100).toFixed(1)}% (positiva)`);
        } else {
            linhas.push(`❌ Margem de lucro: ${(fund.lucroMargem * 100).toFixed(1)}% (negativa)`);
            sinaisNegativos++;
        }
    }

    if (fund.dividaPatrimonio !== null) {
        sinaisTotal++;
        if (fund.dividaPatrimonio < 100) {
            linhas.push(`✅ Dívida/Patrimônio: ${fund.dividaPatrimonio.toFixed(1)} (controlada)`);
        } else if (fund.dividaPatrimonio < 200) {
            linhas.push(`⚠️ Dívida/Patrimônio: ${fund.dividaPatrimonio.toFixed(1)} (elevada)`);
        } else {
            linhas.push(`❌ Dívida/Patrimônio: ${fund.dividaPatrimonio.toFixed(1)} (alta)`);
            sinaisNegativos++;
        }
    }

    if (fund.retornoPatrimonio !== null) {
        sinaisTotal++;
        if (fund.retornoPatrimonio > 0.1) {
            linhas.push(`✅ Retorno sobre patrimônio (ROE): ${(fund.retornoPatrimonio * 100).toFixed(1)}%`);
        } else if (fund.retornoPatrimonio > 0) {
            linhas.push(`⚠️ Retorno sobre patrimônio (ROE): ${(fund.retornoPatrimonio * 100).toFixed(1)}% (modesto)`);
        } else {
            linhas.push(`❌ Retorno sobre patrimônio (ROE): ${(fund.retornoPatrimonio * 100).toFixed(1)}% (negativo)`);
            sinaisNegativos++;
        }
    }

    // --- NOVO: Dívida Líquida/EBITDA — puramente numérico, sem contar
    // no "sinaisNegativos" (não altera o status geral já existente,
    // só soma informação extra pro usuário avaliar).
    if (fund.dividaLiquidaEbitda !== null) {
        linhas.push(`📊 Dívida Líquida/EBITDA: ${fund.dividaLiquidaEbitda.toFixed(1)}x`);
    }

    // --- NOVO: Lucro líquido por trimestre — puramente numérico ---
    if (fund.lucrosTrimestrais && fund.lucrosTrimestrais.length > 0) {
        const linhasLucro = fund.lucrosTrimestrais
            .map((t) => {
                const mesAno = t.dataFim.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
                const emMilhoes = (t.lucroLiquido / 1_000_000).toFixed(1);
                return `${mesAno}: R$ ${emMilhoes}mi`;
            })
            .join(' | ');
        linhas.push(`📊 Lucro líquido (últ. trimestres): ${linhasLucro}`);
    } else {
        linhas.push(`📊 Lucro líquido trimestral: dado indisponível`);
    }

    if (sinaisTotal === 0) {
        return { status: 'sem_dados', linhas: [] };
    }

    let status;
    if (sinaisNegativos === 0) status = 'saudavel';
    else if (sinaisNegativos < sinaisTotal) status = 'atencao';
    else status = 'deteriorado';

    return { status, linhas };
}

module.exports = {
    buscarFundamentos,
    classificarSaudeFinanceira,
};
