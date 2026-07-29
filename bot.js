// Arquivo: bot.js — NOVA (Bot de Análise de Mercado)
// VERSÃO POLLING — adaptado para rodar no Termux (Android), sem
// depender de webhook, domínio público ou porta exposta.
//
// O QUE MUDOU EM RELAÇÃO À VERSÃO WEBHOOK (Azure):
// - Removido: express, app.listen, bot.webhookCallback, setWebhook.
// - Adicionado: dotenv (lê o arquivo .env local) e bot.launch()
//   (ativa o modo polling — o bot passa a buscar updates ativamente
//   no Telegram, em vez de esperar o Telegram chamar uma URL).
// - Toda a lógica de comandos abaixo é IDÊNTICA à versão anterior.

require('dotenv').config();

// CAPTURA DE ERROS PARA APARECER NO LOG (visível via `pm2 logs`)
process.on('uncaughtException', (err) => {
    console.error('ERRO NÃO CAPTURADO:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('PROMISE REJEITADA:', reason);
});

const { Telegraf } = require('telegraf');
const mercado = require('./mercado');
const listaPadrao = require('./listaPadrao');
const analise = require('./analise');
const indices = require('./indices');
const grafico = require('./grafico');
const longoPrazo = require('./longoPrazo');
const scanner = require('./scanner');
const carteira = require('./carteira');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (!TELEGRAM_TOKEN) {
    console.error('❌ TELEGRAM_TOKEN não encontrado no .env. O bot não pode iniciar.');
    process.exit(1);
}

const bot = new Telegraf(TELEGRAM_TOKEN);

const estadoConversa = new Map();

bot.start((ctx) => ctx.reply(
    "🚀 *NOVA Ativo!*\n\nSou seu bot de análise de mercado global (ações Brasil + EUA).\n\n" +
    "Comandos disponíveis:\n" +
    "/investir — varredura completa de mercado\n" +
    "/grafico — gráfico dos últimos 30 dias de um ativo\n" +
    "/scanner — análise individual (preço + fundamentos, quando disponíveis)\n" +
    "/carteira — ver sua carteira (meta vs. atual)\n" +
    "`/carteira_add` — adicionar ativo à carteira\n" +
    "`/carteira_remover` — remover ativo da carteira",
    { parse_mode: 'Markdown' }
));

bot.command('investir', async (ctx) => {
    estadoConversa.set(ctx.chat.id, { etapa: 'aguardando_valor' });
    await ctx.reply(
        "💰 Qual valor você pretende investir?\n\n(Digite apenas o número, ex: 100. Ou digite *pular* se não quiser informar.)",
        { parse_mode: 'Markdown' }
    );
});

bot.command('grafico', async (ctx) => {
    estadoConversa.set(ctx.chat.id, { etapa: 'aguardando_ticker_grafico' });
    await ctx.reply(
        "📈 Qual ativo você quer ver no gráfico?\n\n(Ex: `PETR4.SA`, `AAPL`, `VALE3.SA`)",
        { parse_mode: 'Markdown' }
    );
});

bot.command('scanner', async (ctx) => {
    estadoConversa.set(ctx.chat.id, { etapa: 'aguardando_ticker_scanner' });
    await ctx.reply(
        "⚡ Qual ativo você quer analisar?\n\n(Ex: `PETR4.SA`, `AAPL`, `VALE3.SA`)\n\n" +
        "_Fundamentos financeiros disponíveis apenas para ativos do Brasil nesta versão._",
        { parse_mode: 'Markdown' }
    );
});

bot.command('carteira', async (ctx) => {
    await ctx.reply("📂 Calculando alocação atual da carteira...");
    try {
        const resultado = await carteira.calcularAlocacao();
        const texto = carteira.formatarCarteira(resultado);
        await ctx.reply(texto, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("Erro ao calcular carteira:", e.message);
        await ctx.reply("⚠️ Ocorreu um erro ao calcular a carteira. Tente novamente com /carteira.");
    }
});

bot.command(['carteira_add', 'carteiraadd'], async (ctx) => {
    estadoConversa.set(ctx.chat.id, { etapa: 'aguardando_ticker_carteira_add' });
    await ctx.reply(
        "➕ Qual ativo você quer adicionar à carteira?\n\n(Ex: `HSBC`, `PETR4.SA`, `VOO`)",
        { parse_mode: 'Markdown' }
    );
});

bot.command(['carteira_remover', 'carteiraremover'], async (ctx) => {
    estadoConversa.set(ctx.chat.id, { etapa: 'aguardando_ticker_carteira_remover' });
    await ctx.reply(
        "➖ Qual ativo você quer remover da carteira?\n\n(Digite o ticker, ex: `HSBC`)",
        { parse_mode: 'Markdown' }
    );
});

bot.command('cancelar', async (ctx) => {
    estadoConversa.delete(ctx.chat.id);
    await ctx.reply("❌ Operação cancelada.");
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const texto = ctx.message.text.trim();
    const estado = estadoConversa.get(chatId);

    if (!estado) return;

    if (estado.etapa === 'aguardando_valor') {
        const valorInformado = texto.toLowerCase() === 'pular' ? null : parseFloat(texto.replace(',', '.'));
        estadoConversa.delete(chatId);

        const listaCompleta = listaPadrao.LISTA_PADRAO_COMPLETA;
        const globaisCount = listaCompleta.filter((t) => !t.toUpperCase().endsWith('.SA')).length;
        const tempoEstimadoMin = Math.ceil(((globaisCount + 2) * 8) / 60);
        await ctx.reply(
            `🔍 *Varredura iniciada* — ${listaCompleta.length} ativos + índices.\nTempo estimado: ~${tempoEstimadoMin} min (respeitando limite da API).\nAguarde...`,
            { parse_mode: 'Markdown' }
        );

        try {
            const indicesResultado = await indices.buscarTodosIndices();
            const textoIndices = indices.formatarIndices(indicesResultado);
            await ctx.reply(textoIndices, { parse_mode: 'Markdown' });

            const cotacoes = await mercado.buscarMultiplasCotacoesOtimizado(listaCompleta);
            const relatorio = analise.gerarRelatorioVarredura(cotacoes, valorInformado);
            await ctx.reply(relatorio, { parse_mode: 'Markdown' });

            if (valorInformado) {
                const textoOrcamento = await analise.gerarRelatorioOrcamento(cotacoes, valorInformado);
                await ctx.reply(textoOrcamento, { parse_mode: 'Markdown' });
            }

            const { quedas, altas } = analise.classificarCotacoes(cotacoes);
            const tickersParaContexto = [
                ...quedas.slice(0, 3).map((c) => c.ticker),
                ...altas.slice(0, 3).map((c) => c.ticker),
            ];

            if (tickersParaContexto.length > 0) {
                await ctx.reply(`📅 Buscando contexto de longo prazo para os destaques do dia...`);
                const contextos = await longoPrazo.buscarContextoLongoPrazo(tickersParaContexto);
                const textoContexto = longoPrazo.formatarContextoLongoPrazo(contextos);
                await ctx.reply(textoContexto, { parse_mode: 'Markdown' });
            }
        } catch (e) {
            console.error("Erro na varredura:", e.message);
            await ctx.reply("⚠️ Ocorreu um erro durante a varredura. Tente novamente com /investir.");
        }
        return;
    }

    if (estado.etapa === 'aguardando_ticker_grafico') {
        const ticker = texto.toUpperCase();
        estadoConversa.delete(chatId);

        try {
            await ctx.reply(
                `📈 Gráfico interativo de \`${ticker}\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '📊 Abrir Gráfico',
                                web_app: { url: `https://nova-mu-rose.vercel.app/?ticker=${encodeURIComponent(ticker)}` }
                            }
                        ]]
                    }
                }
            );
        } catch (e) {
            console.error("Erro no gráfico:", e.message);
            await ctx.reply("⚠️ Ocorreu um erro ao gerar o gráfico. Tente novamente com /grafico.");
        }
        return;
    }

    if (estado.etapa === 'aguardando_ticker_scanner') {
        const ticker = texto.toUpperCase();
        estadoConversa.delete(chatId);

        await ctx.reply(`⚡ Escaneando \`${ticker}\`...`, { parse_mode: 'Markdown' });

        try {
            const relatorio = await scanner.gerarRelatorioScanner(ticker);
            await ctx.reply(relatorio, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("Erro no scanner:", e.message);
            await ctx.reply("⚠️ Ocorreu um erro ao escanear o ativo. Tente novamente com /scanner.");
        }
        return;
    }

    if (estado.etapa === 'aguardando_ticker_carteira_add') {
        const ticker = texto.toUpperCase();
        estadoConversa.set(chatId, { etapa: 'aguardando_quantidade_carteira_add', ticker });
        await ctx.reply("🔢 Quantas unidades/cotas você tem?\n\n(Ex: 2 ou 2.5)");
        return;
    }

    if (estado.etapa === 'aguardando_quantidade_carteira_add') {
        const quantidade = parseFloat(texto.replace(',', '.'));
        if (isNaN(quantidade) || quantidade <= 0) {
            await ctx.reply("⚠️ Quantidade inválida. Digite um número, ex: 2 ou 2.5");
            return;
        }
        estadoConversa.set(chatId, { ...estado, etapa: 'aguardando_preco_medio_carteira_add', quantidade });
        await ctx.reply(
            "💵 Qual foi o preço médio de compra?\n\n(Ex: 42.50. Ou digite *pular* se não quiser acompanhar ganho/perda deste ativo.)",
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (estado.etapa === 'aguardando_preco_medio_carteira_add') {
        let precoMedio = null;

        if (texto.toLowerCase() !== 'pular') {
            precoMedio = parseFloat(texto.replace(',', '.'));
            if (isNaN(precoMedio) || precoMedio <= 0) {
                await ctx.reply("⚠️ Preço inválido. Digite um número, ex: 42.50, ou *pular*.", { parse_mode: 'Markdown' });
                return;
            }
        }

        estadoConversa.set(chatId, { ...estado, etapa: 'aguardando_meta_carteira_add', precoMedio });
        await ctx.reply("🎯 Qual a meta de alocação (%) desse ativo na sua carteira?\n\n(Ex: 25)");
        return;
    }

    if (estado.etapa === 'aguardando_meta_carteira_add') {
        const metaPercentual = parseFloat(texto.replace(',', '.').replace('%', ''));
        if (isNaN(metaPercentual) || metaPercentual <= 0 || metaPercentual > 100) {
            await ctx.reply("⚠️ Meta inválida. Digite um número entre 0 e 100, ex: 25");
            return;
        }
        estadoConversa.delete(chatId);

        try {
            const resultado = await carteira.adicionarAtivo(estado.ticker, estado.quantidade, metaPercentual, estado.precoMedio);
            if (resultado.sucesso) {
                const linhaPreco = estado.precoMedio ? `\nPreço médio: ${estado.precoMedio}` : '';
                await ctx.reply(
                    `✅ \`${estado.ticker}\` adicionado à carteira!\nQuantidade: ${estado.quantidade}${linhaPreco}\nMeta: ${metaPercentual}%\n\nUse /carteira para ver a alocação completa.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(`⚠️ Não foi possível salvar: ${resultado.erro}`);
            }
        } catch (e) {
            console.error("Erro ao adicionar à carteira:", e.message);
            await ctx.reply("⚠️ Ocorreu um erro ao salvar. Tente novamente com /carteira_add.");
        }
        return;
    }

    if (estado.etapa === 'aguardando_ticker_carteira_remover') {
        const ticker = texto.toUpperCase();
        estadoConversa.delete(chatId);

        try {
            const resultado = await carteira.removerAtivo(ticker);
            if (resultado.sucesso) {
                await ctx.reply(`🗑️ \`${ticker}\` removido da carteira.`, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(`⚠️ Não foi possível remover: ${resultado.erro || 'ticker não encontrado'}`);
            }
        } catch (e) {
            console.error("Erro ao remover da carteira:", e.message);
            await ctx.reply("⚠️ Ocorreu um erro ao remover. Tente novamente com /carteira_remover.");
        }
        return;
    }
});

// ========== INÍCIO DO BOT (POLLING) ==========
// Antes de ativar o polling, remove qualquer webhook antigo que possa
// ter ficado configurado no Telegram (da época do Azure) — se os dois
// modos ficarem ativos ao mesmo tempo, o Telegram rejeita updates.
async function iniciar() {
    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        console.log('✅ Webhook antigo removido (se existia).');
    } catch (err) {
        console.error('⚠️ Não foi possível remover webhook antigo:', err.message);
    }

    await bot.launch();
    console.log('🚀 NOVA rodando em modo POLLING — aguardando mensagens no Telegram.');
}

iniciar();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
