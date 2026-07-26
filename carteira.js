// Arquivo: carteira.js — NOVA (Carteira em arquivo local, sem Supabase)
//
// FASE 5 do roadmap — adicionado nesta versão:
// - Preço médio de compra (opcional) por ativo
// - Ganho/perda por ativo, calculado no PREÇO NA MOEDA ORIGINAL do
//   ativo (não em BRL) — evita ter que assumir uma cotação histórica
//   do dólar que não temos guardada, e é a métrica mais padrão que
//   um investidor usa pra avaliar desempenho de um ativo específico.
// - "Próximo aporte": lista os ativos abaixo da meta, em ordem de
//   prioridade. NUNCA sugere venda — só aponta onde direcionar
//   dinheiro novo, conforme princípio permanente do NOVA.

const fs = require('fs');
const path = require('path');
const { buscarCotacaoUSDBRL } = require('./mercado');

const CARTEIRA_PATH = path.join(__dirname, 'carteira.json');

// ─── Helpers ─────────────────────────────────────────────
function lerCarteira() {
    try {
        if (!fs.existsSync(CARTEIRA_PATH)) return [];
        const raw = fs.readFileSync(CARTEIRA_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error('Erro ao ler carteira:', e.message);
        return [];
    }
}

function salvarCarteira(carteira) {
    try {
        fs.writeFileSync(CARTEIRA_PATH, JSON.stringify(carteira, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Erro ao salvar carteira:', e.message);
        return false;
    }
}

/**
 * Busca preço E moeda de um ticker via Yahoo Finance.
 */
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

/**
 * Converte um preço para BRL, se necessário.
 */
function converterParaBRL(preco, moeda, cotacaoUSDBRL) {
    if (!moeda || moeda === 'BRL') {
        return preco;
    }
    if (moeda === 'USD') {
        return preco * cotacaoUSDBRL;
    }
    return null;
}

// ─── Funções principais ──────────────────────────────────

async function calcularAlocacao() {
    const carteira = lerCarteira();
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

        // --- NOVO: ganho/perda, calculado na moeda ORIGINAL do ativo ---
        // (evita depender de uma cotação histórica do dólar que não
        // guardamos — compara maçã com maçã, preço com preço).
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

/**
 * NOVO — Sugestão de próximo aporte. Lista os ativos ABAIXO da meta,
 * do mais prioritário (maior distância da meta) pro menos.
 * NUNCA inclui sugestão de venda — só onde colocar dinheiro novo.
 */
function gerarSugestaoAporte(resultado) {
    if (resultado.vazio) return [];

    return resultado.ativos
        .filter((a) => parseFloat(a.diferenca) < 0)
        .sort((a, b) => parseFloat(a.diferenca) - parseFloat(b.diferenca)); // mais negativo primeiro
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

    // --- NOVO: Próximo aporte ---
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
    const carteira = lerCarteira();
    const idx = carteira.findIndex(a => a.ticker.toUpperCase() === ticker.toUpperCase());

    if (idx >= 0) {
        carteira[idx].quantidade = quantidade;
        carteira[idx].metaPercentual = metaPercentual;
        carteira[idx].precoMedio = precoMedio;
    } else {
        carteira.push({
            ticker: ticker.toUpperCase(),
            quantidade: quantidade,
            metaPercentual: metaPercentual,
            precoMedio: precoMedio,
            criadoEm: new Date().toISOString(),
        });
    }

    const ok = salvarCarteira(carteira);
    return { sucesso: ok, erro: ok ? null : 'Falha ao salvar arquivo' };
}

async function removerAtivo(ticker) {
    let carteira = lerCarteira();
    const antes = carteira.length;
    carteira = carteira.filter(a => a.ticker.toUpperCase() !== ticker.toUpperCase());

    if (carteira.length === antes) {
        return { sucesso: false, erro: 'Ativo não encontrado' };
    }

    const ok = salvarCarteira(carteira);
    return { sucesso: ok, erro: ok ? null : 'Falha ao salvar arquivo' };
}

module.exports = {
    calcularAlocacao,
    formatarCarteira,
    adicionarAtivo,
    removerAtivo,
    gerarSugestaoAporte,
};
