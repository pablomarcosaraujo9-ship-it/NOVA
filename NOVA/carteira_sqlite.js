const db = require('./db_shell');

// ─── LER CARTEIRA DO SQLITE ──────────────────────────
async function lerCarteira() {
    return new Promise((resolve, reject) => {
        db.getPortfolio((err, rows) => {
            if (err) reject(err);
            else {
                const carteira = rows.map(row => ({
                    ticker: row.ticker,
                    quantidade: row.quantidade,
                    metaPercentual: 10, // meta padrão
                    precoMedio: row.preco_compra || null,
                }));
                resolve(carteira);
            }
        });
    });
}

// ─── BUSCAR PREÇO (YAHOO) ────────────────────────────
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
    if (!moeda || moeda === 'BRL') return preco;
    if (moeda === 'USD') return preco * cotacaoUSDBRL;
    return null;
}

// ─── CALCULAR ALOCAÇÃO ──────────────────────────────
async function calcularAlocacao() {
    const carteira = await lerCarteira();
    if (carteira.length === 0) {
        return { ativos: [], total: 0, vazio: true };
    }

    let cotacaoUSDBRL = null;
    try {
        const { buscarCotacaoUSDBRL } = require('./mercado');
        cotacaoUSDBRL = await buscarCotacaoUSDBRL();
    } catch (e) {
        console.error('Erro ao buscar cotação USD/BRL:', e.message);
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
        if (item.precoMedio !== null && preco) {
            ganhoPerdaAbsolutoOriginal = preco - item.precoMedio;
            ganhoPerdaPercentual = (ganhoPerdaAbsolutoOriginal / item.precoMedio) * 100;
        }

        ativosComPreco.push({
            ticker: item.ticker,
            quantidade: item.quantidade,
            metaPercentual: item.metaPercentual || 10,
            precoMedio: item.precoMedio ?? null,
            preco,
            moeda,
            valor: valorEmBRL,
            valorOriginal,
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
        .filter(a => parseFloat(a.diferenca) < 0)
        .sort((a, b) => parseFloat(a.diferenca) - parseFloat(b.diferenca));
}

function formatarCarteira(resultado) {
    if (resultado.vazio) {
        return `📂 *Sua Carteira*\n\n_Carteira vazia._\n\nUse /carteira_add para adicionar ativos.`;
    }

    let texto = `📂 *Sua Carteira (via SQLite)*\n💰 Valor total: R$ ${resultado.total}\n───────────────────────\n\n`;
    for (const a of resultado.ativos) {
        const precoStr = a.preco ? `${a.moeda} ${a.preco.toFixed(2)}` : 'Preço indisponível';
        const emojiDiff = parseFloat(a.diferenca) > 0 ? '🟢' : parseFloat(a.diferenca) < 0 ? '🔴' : '⚪';
        texto += `• *${a.ticker}*\n  Quantidade: ${a.quantidade}\n  Preço atual: ${precoStr}\n`;
        if (a.precoMedio !== null) texto += `  Preço médio: ${a.moeda} ${a.precoMedio.toFixed(2)}\n`;
        if (a.ganhoPerdaPercentual !== null) {
            const emojiGanho = a.ganhoPerdaPercentual >= 0 ? '📈' : '📉';
            const sinal = a.ganhoPerdaPercentual >= 0 ? '+' : '';
            texto += `  ${emojiGanho} Ganho/Perda: ${sinal}${a.ganhoPerdaPercentual.toFixed(2)}% (${a.moeda} ${sinal}${a.ganhoPerdaAbsolutoOriginal.toFixed(2)}/un.)\n`;
        }
        texto += `  Valor: R$ ${a.valor.toFixed(2)}\n  Meta: ${a.metaPercentual}% | Real: ${a.percentualReal}%\n  ${emojiDiff} Diferença: ${a.diferenca}%\n\n`;
    }

    const sugestoes = gerarSugestaoAporte(resultado);
    if (sugestoes.length > 0) {
        texto += `🎯 *Próximo aporte* (prioridade)\n`;
        sugestoes.forEach((a, i) => {
            texto += `${i+1}. ${a.ticker} — Real: ${a.percentualReal}% | Meta: ${a.metaPercentual}%\n`;
        });
        texto += `\n_Sugestão: direcione aportes para os ativos mais distantes da meta._\n\n`;
    }

    if (resultado.cotacaoUSDBRL) {
        texto += `_Cotação USD/BRL usada: ${resultado.cotacaoUSDBRL.toFixed(2)}_\n`;
    }
    if (resultado.totalIncompleto) {
        texto += `⚠️ _Valor total pode estar incompleto (conversão USD/BRL não disponível)._`;
    }
    texto += `\n⚠️ _Alocação calculada com base nos preços atuais._`;
    return texto;
}

async function adicionarAtivo(ticker, quantidade, metaPercentual, precoMedio = null) {
    return new Promise((resolve) => {
        db.addPortfolio(ticker, quantidade, precoMedio || 0, (err) => {
            if (err) resolve({ sucesso: false, erro: err.message });
            else resolve({ sucesso: true, erro: null });
        });
    });
}

async function removerAtivo(ticker) {
    // Remoção não implementada no SQLite via db_shell (por simplicidade)
    return { sucesso: false, erro: 'Remoção não implementada no SQLite ainda' };
}

module.exports = {
    calcularAlocacao,
    formatarCarteira,
    adicionarAtivo,
    removerAtivo,
    gerarSugestaoAporte,
};
