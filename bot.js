// Arquivo: bot.js — NOVA (Bot de Análise de Mercado)

// CAPTURA DE ERROS PARA APARECER NO LOG DO RENDER
process.on('uncaughtException', (err) => {
    console.error('ERRO NÃO CAPTURADO:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('PROMISE REJEITADA:', reason);
});

const express = require('express');
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
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(TELEGRAM_TOKEN);
const app = express();

// NÃO usar express.json() quando usa webhook do Telegraf
// O Telegraf lida com o body parser internamente

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

// ========== COMANDO PARA VERIFICAR WEBHOOK ==========
bot.command('webhook', async (ctx) => {
    try {
        const info = await bot.telegram.getWebhookInfo();
        const url = info.url || "(não configurado)";
        const pending = info.pending_update_count || 0;
        const lastError = info.last_error_message || "nenhum";
        await ctx.reply(
            `🔍 *Status do Webhook*\n\n` +
            `📍 URL: ${url}\n` +
            `⏳ Updates pendentes: ${pending}\n` +
            `❌ Último erro: ${lastError}`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await ctx.reply(`⚠️ Erro ao verificar webhook: ${e.message}`);
    }
});

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

// ========== WEBHOOK ==========
// O Telegraf lida com o body parser internamente — NÃO usar express.json()
app.use(bot.webhookCallback('/webhook'));

// Health check pro Azure saber que o app está vivo
app.get('/', (req, res) => {
    res.send('🤖 NOVA Bot online via Webhook!');
});

app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);

    // Configura o webhook automaticamente no Telegram
    const webhookUrl = `https://meu-bot-telegram-2026-d9g8ekhheca2cfhg.canadacentral-01.azurewebsites.net/webhook`;

    try {
        await bot.telegram.setWebhook(webhookUrl);
        console.log('✅ Webhook configurado:', webhookUrl);
    } catch (err) {
        console.error('❌ Erro ao configurar webhook:', err.message);
    }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
