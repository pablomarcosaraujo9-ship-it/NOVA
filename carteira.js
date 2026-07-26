// Arquivo: carteira.js — NOVA (Carteira persistida no Supabase)
//
// MIGRAÇÃO: substitui o armazenamento em carteira.json (perdido a cada
// redeploy) por uma tabela `portfolios` no Supabase. Todas as funções
// exportadas mantêm a MESMA assinatura de antes — bot.js não precisa
// de nenhuma alteração.
//
// A carteira continua sendo ÚNICA e compartilhada (não há separação
// por usuário do Telegram ainda). Usamos um user_id fixo ('default')
// na tabela só para deixar o schema já pronto para multi-usuário no
// futuro, sem mudar o comportamento atual.
//
// FASE 5 do roadmap (mantido):
// - Preço médio de compra (opcional) por ativo
// - Ganho/perda por ativo, calculado no PREÇO NA MOEDA ORIGINAL do
//   ativo (não em BRL)
// - "Próximo aporte": lista os ativos abaixo da meta, em ordem de
//   prioridade. NUNCA sugere venda.

const { createClient } = require('@supabase/supabase-js');
const { buscarCotacaoUSDBRL } = require('./mercado');

const USER_ID_PADRAO = 'default'; // carteira única/compartilhada, por enquanto

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Helpers de persistência ─────────────────────────────
async function lerCarteira() {
    const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .eq('user_id', USER_ID_PADRAO);

    if (error) {
        console.error('Erro ao ler carteira do Supabase:', error.message);
        return [];
    }

    // Mapeia snake_case (banco) -> camelCase (resto do código, igual ao JSON antigo)
    return data.map((row) => ({
        ticker: row.ticker,
        quantidade: Number(row.quantidade),
        metaPercentual: Number(row.meta_percentual),
        precoMedio: row.preco_medio !== null ? Number(row.preco_medio) : null,
        criadoEm: row.created_at,
    }));
}

// ─── Busca de preço (inalterado) ─────────────────────────
async function buscarPreco(ticker) {
    try {
        const symbol = ticker.toUpperCase();
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        const res = await fetch(url);
        const data = await res.json();
        const meta = data.chart?.result?.[0]?.meta;
        const preco = meta?.regularMarketPrice;
        const moeda = meta?.currency || 'BRL';

        if (!preco) throw new Error('Preço não disponível');
        return { preco: parseFloat(preco), moeda };
    } catch (e) {
        console.error(`Erro ao buscar ${ticker}:`, e.message);
        return { preco: null, moeda: null };
    }
}

function converterParaBRL(preco, moeda, cotacaoUSDBRL) {
    if (!moeda || moeda === 'BRL') {
        return preco;
    }
    if (moeda === 'USD') {
        return preco * cotacaoUSDBRL;
    }
    return null;
}

// ─── Funções principais (mesma lógica de antes) ──────────

async function calcularAlocacao() {
    const carteira = await lerCarteira();
    if (carteira.length === 0) {
        return { ativos: [], total: 0, vazio: true };
    }

    let cotacaoUSDBRL = null;
    try {
        cotacaoUSDBRL = await buscarCotacaoUSDBRL();
    } catch (e) {
        console.error('Erro ao buscar cotação USD/BRL para a carteira:', e.message);
    }

    const ativosComPreco = [];
    let total = 0;
    let totalIncompleto = false;

    for (const item of carteira) {
        const { preco, moeda } = await buscarPreco(item.ticker);
        const valorOriginal = preco ? preco * item.quantidade : 0;

        let valorEmBRL = valorOriginal;
        if (preco && moeda !== 'BRL') {
            if (cotacaoUSDBRL) {
                const precoConvertido = converterParaBRL(preco, moeda, cotacaoUSDBRL);
                valorEmBRL = precoConvertido !== null ? precoConvertido * item.quantidade : 0;
                if (precoConvertido === null) totalIncompleto = true;
            } else {
                valorEmBRL = 0;
                totalIncompleto = true;
            }
        }

        let ganhoPerdaPercentual = null;
        let ganhoPerdaAbsolutoOriginal = null;

        if (item.precoMedio !== null && item.precoMedio !== undefined && preco) {
            ganhoPerdaAbsolutoOriginal = preco - item.precoMedio;
            ganhoPerdaPercentual = (ganhoPerdaAbsolutoOriginal / item.precoMedio) * 100;
        }

        ativosComPreco.push({
            ticker: item.ticker,
            quantidade: item.quantidade,
            metaPercentual: item.metaPercentual,
            precoMedio: item.precoMedio ?? null,
            preco: preco,
            moeda: moeda,
            valor: valorEmBRL,
            valorOriginal: valorOriginal,
            ganhoPerdaPercentual,
            ganhoPerdaAbsolutoOriginal,
        });
        total += valorEmBRL;
    }

    for (const ativo of ativosComPreco) {
        ativo.percentualReal = total > 0 ? ((ativo.valor / total) * 100).toFixed(2) : '0.00';
        ativo.diferenca = (parseFloat(ativo.percentualReal) - ativo.metaPercentual).toFixed(2);
    }

    return {
        ativos: ativosComPreco,
        total: total.toFixed(2),
        vazio: false,
        totalIncompleto,
        cotacaoUSDBRL,
    };
}

function gerarSugestaoAporte(resultado) {
    if (resultado.vazio) return [];

    return resultado.ativos
        .filter((a) => parseFloat(a.diferenca) < 0)
        .sort((a, b) => parseFloat(a.diferenca) - parseFloat(b.diferenca));
}

function formatarCarteira(resultado) {
    if (resultado.vazio) {
        return `📂 *Sua Carteira*\n\n` +
            `_Carteira vazia._\n\n` +
            `Use /carteira_add para adicionar ativos.`;
    }

    let texto = `📂 *Sua Carteira*\n` +
        `💰 Valor total: R$ ${resultado.total}\n` +
        `───────────────────────\n\n`;

    for (const a of resultado.ativos) {
        const precoStr = a.preco ? `${a.moeda} ${a.preco.toFixed(2)}` : 'Preço indisponível';
        const emojiDiff = parseFloat(a.diferenca) > 0 ? '🟢' : parseFloat(a.diferenca) < 0 ? '🔴' : '⚪';

        texto += `• *${a.ticker}*\n` +
            `  Quantidade: ${a.quantidade}\n` +
            `  Preço atual: ${precoStr}\n`;

        if (a.precoMedio !== null) {
            texto += `  Preço médio: ${a.moeda} ${a.precoMedio.toFixed(2)}\n`;
        }

        if (a.ganhoPerdaPercentual !== null) {
            const emojiGanho = a.ganhoPerdaPercentual >= 0 ? '📈' : '📉';
            const sinal = a.ganhoPerdaPercentual >= 0 ? '+' : '';
            texto += `  ${emojiGanho} Ganho/Perda: ${sinal}${a.ganhoPerdaPercentual.toFixed(2)}% ` +
                `(${a.moeda} ${sinal}${a.ganhoPerdaAbsolutoOriginal.toFixed(2)}/un.)\n`;
        }

        texto += `  Valor: R$ ${a.valor.toFixed(2)}\n` +
            `  Meta: ${a.metaPercentual}% | Real: ${a.percentualReal}%\n` +
            `  ${emojiDiff} Diferença: ${a.diferenca}%\n\n`;
    }

    const sugestoes = gerarSugestaoAporte(resultado);
    if (sugestoes.length > 0) {
        texto += `🎯 *Próximo aporte* (prioridade, do mais distante da meta)\n`;
        sugestoes.forEach((a, i) => {
            texto += `${i + 1}. ${a.ticker} — Real: ${a.percentualReal}% | Meta: ${a.metaPercentual}%\n`;
        });
        texto += `\n_Sugestão só indica onde direcionar aportes novos — o NOVA nunca recomenda venda para rebalancear._\n\n`;
    }

    if (resultado.cotacaoUSDBRL) {
        texto += `_Cotação USD/BRL usada: ${resultado.cotacaoUSDBRL.toFixed(2)}_\n`;
    }
    if (resultado.totalIncompleto) {
        texto += `⚠️ _Não foi possível converter todos os ativos para BRL — o valor total pode estar incompleto._\n`;
    }
    texto += `⚠️ _Alocação calculada com base nos preços atuais do mercado._`;
    return texto;
}

/**
 * @param {string} ticker
 * @param {number} quantidade
 * @param {number} metaPercentual
 * @param {number|null} precoMedio - opcional; null se o usuário pulou
 */
async function adicionarAtivo(ticker, quantidade, metaPercentual, precoMedio = null) {
    const { error } = await supabase
        .from('portfolios')
        .upsert(
            {
                user_id: USER_ID_PADRAO,
                ticker: ticker.toUpperCase(),
                quantidade,
                meta_percentual: metaPercentual,
                preco_medio: precoMedio,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,ticker' }
        );

    if (error) {
        console.error('Erro ao salvar no Supabase:', error.message);
        return { sucesso: false, erro: error.message };
    }

    return { sucesso: true, erro: null };
}

async function removerAtivo(ticker) {
    const { data, error } = await supabase
        .from('portfolios')
        .delete()
        .eq('user_id', USER_ID_PADRAO)
        .eq('ticker', ticker.toUpperCase())
        .select();

    if (error) {
        console.error('Erro ao remover do Supabase:', error.message);
        return { sucesso: false, erro: error.message };
    }

    if (!data || data.length === 0) {
        return { sucesso: false, erro: 'Ativo não encontrado' };
    }

    return { sucesso: true, erro: null };
}

module.exports = {
    calcularAlocacao,
    formatarCarteira,
    adicionarAtivo,
    removerAtivo,
    gerarSugestaoAporte,
};
