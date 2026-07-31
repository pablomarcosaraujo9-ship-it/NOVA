require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ---------- FERRAMENTAS DA IA ----------

function listarPastas(caminho = '.') {
  try {
    const caminhoSeguro = path.resolve(caminho);
    const raiz = path.resolve('.');
    if (!caminhoSeguro.startsWith(raiz)) {
      return JSON.stringify({ erro: 'Acesso negado: caminho fora do projeto.' });
    }
    const itens = fs.readdirSync(caminho);
    return JSON.stringify({ pasta: caminho, conteudo: itens });
  } catch (e) {
    return JSON.stringify({ erro: e.message });
  }
}

async function consultarCotacao(ticker) {
  try {
    let tickerFinal = ticker.toUpperCase().trim();

    if (tickerFinal === 'USD-BRL' || tickerFinal === 'USDBRL' || tickerFinal === 'DOLAR') {
      tickerFinal = 'USDBRL=X';
    } else if (!tickerFinal.includes('.') && !tickerFinal.includes('=') && /^[A-Z]{4}\d{1,2}$/.test(tickerFinal)) {
      tickerFinal = `${tickerFinal}.SA`;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${tickerFinal}`;
    const resposta = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const dados = await resposta.json();

    if (dados.chart.error) {
      return JSON.stringify({ erro: `Ticker "${ticker}" não encontrado.` });
    }

    const resultado = dados.chart.result[0];
    const meta = resultado.meta;

    return JSON.stringify({
      ticker: tickerFinal,
      preco_atual: meta.regularMarketPrice,
      moeda: meta.currency,
      fechamento_anterior: meta.previousClose ?? meta.chartPreviousClose,
      variacao_percentual: meta.previousClose
        ? (((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100).toFixed(2)
        : null,
      maxima_dia: meta.regularMarketDayHigh,
      minima_dia: meta.regularMarketDayLow,
      hora_dado: new Date(meta.regularMarketTime * 1000).toISOString(),
    });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao consultar cotação: ${e.message}` });
  }
}

// ---------- FERRAMENTAS DE CARTEIRA (SUPABASE) ----------

async function adicionarAtivo({ ticker, quantidade, preco_medio }) {
  try {
    if (!ticker || !quantidade) {
      return JSON.stringify({ erro: 'Ticker e quantidade são obrigatórios.' });
    }

    const tickerFinal = ticker.toUpperCase().trim();

    const { data: existente } = await supabase
      .from('portfolios')
      .select('*')
      .eq('user_id', 'default')
      .eq('ticker', tickerFinal)
      .maybeSingle();

    if (existente) {
      // Já existe: soma quantidade e recalcula preço médio ponderado (se ambos tiverem preço)
      const novaQtd = Number(existente.quantidade) + Number(quantidade);
      let novoPrecoMedio = existente.preco_medio;

      if (preco_medio && existente.preco_medio) {
        novoPrecoMedio =
          (Number(existente.quantidade) * Number(existente.preco_medio) +
            Number(quantidade) * Number(preco_medio)) /
          novaQtd;
      } else if (preco_medio && !existente.preco_medio) {
        novoPrecoMedio = preco_medio;
      }

      const { error } = await supabase
        .from('portfolios')
        .update({ quantidade: novaQtd, preco_medio: novoPrecoMedio, updated_at: new Date().toISOString() })
        .eq('id', existente.id);

      if (error) return JSON.stringify({ erro: error.message });

      return JSON.stringify({
        sucesso: true,
        acao: 'atualizado',
        ticker: tickerFinal,
        quantidade_total: novaQtd,
        preco_medio: novoPrecoMedio,
      });
    }

    const { error } = await supabase.from('portfolios').insert({
      user_id: 'default',
      ticker: tickerFinal,
      quantidade,
      preco_medio: preco_medio ?? null,
    });

    if (error) return JSON.stringify({ erro: error.message });

    return JSON.stringify({ sucesso: true, acao: 'adicionado', ticker: tickerFinal, quantidade, preco_medio: preco_medio ?? null });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao adicionar ativo: ${e.message}` });
  }
}

async function removerAtivo({ ticker, quantidade }) {
  try {
    if (!ticker) {
      return JSON.stringify({ erro: 'Ticker é obrigatório.' });
    }

    const tickerFinal = ticker.toUpperCase().trim();

    const { data: existente } = await supabase
      .from('portfolios')
      .select('*')
      .eq('user_id', 'default')
      .eq('ticker', tickerFinal)
      .maybeSingle();

    if (!existente) {
      return JSON.stringify({ erro: `Ativo ${tickerFinal} não encontrado na carteira.` });
    }

    // Sem quantidade especificada: remove o ativo inteiro
    if (!quantidade || Number(quantidade) >= Number(existente.quantidade)) {
      const { error } = await supabase.from('portfolios').delete().eq('id', existente.id);
      if (error) return JSON.stringify({ erro: error.message });
      return JSON.stringify({ sucesso: true, acao: 'removido_completo', ticker: tickerFinal });
    }

    // Remove parcialmente
    const novaQtd = Number(existente.quantidade) - Number(quantidade);
    const { error } = await supabase
      .from('portfolios')
      .update({ quantidade: novaQtd, updated_at: new Date().toISOString() })
      .eq('id', existente.id);

    if (error) return JSON.stringify({ erro: error.message });

    return JSON.stringify({ sucesso: true, acao: 'removido_parcial', ticker: tickerFinal, quantidade_restante: novaQtd });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao remover ativo: ${e.message}` });
  }
}

async function verCarteira() {
  try {
    const { data, error } = await supabase.from('portfolios').select('*').eq('user_id', 'default');

    if (error) return JSON.stringify({ erro: error.message });

    if (!data || data.length === 0) {
      return JSON.stringify({ carteira: [], mensagem: 'Carteira vazia.' });
    }

    // Busca cotação atual de cada ativo em paralelo
    const carteiraComCotacao = await Promise.all(
      data.map(async (item) => {
        const cotacaoRaw = await consultarCotacao(item.ticker);
        const cotacao = JSON.parse(cotacaoRaw);
        return {
          ticker: item.ticker,
          quantidade: item.quantidade,
          preco_medio: item.preco_medio,
          preco_atual: cotacao.preco_atual ?? null,
          erro_cotacao: cotacao.erro ?? null,
        };
      })
    );

    return JSON.stringify({ carteira: carteiraComCotacao });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao consultar carteira: ${e.message}` });
  }
}

const MAPA_FERRAMENTAS = {
  listar_pastas: (args) => listarPastas(args.caminho),
  consultar_cotacao: (args) => consultarCotacao(args.ticker),
  adicionar_ativo: (args) => adicionarAtivo(args),
  remover_ativo: (args) => removerAtivo(args),
  ver_carteira: () => verCarteira(),
};

const DECLARACAO_FERRAMENTAS = [
  {
    name: 'listar_pastas',
    description: 'Lista os arquivos e pastas de um diretório do projeto',
    parameters: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: "Caminho da pasta a listar, ex: '.', 'src'" },
      },
    },
  },
  {
    name: 'consultar_cotacao',
    description:
      'Consulta a cotação atual (ao vivo) de um ativo: ações brasileiras (ex: PETR4, VALE3), ações americanas (ex: AAPL, TSLA) ou câmbio USD-BRL (use "USD-BRL"). Use sempre que o usuário pedir cotação, preço atual, "ao vivo", "hoje", variação ou fechamento de um ativo.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código do ativo, ex: PETR4, AAPL, USD-BRL' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'adicionar_ativo',
    description:
      'Adiciona um ativo (ação, FII, etc) à carteira do usuário, ou aumenta a quantidade se já existir. Use quando o usuário disser "comprei", "quero adicionar", "coloca na minha carteira", etc.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código do ativo, ex: PETR4, VALE3' },
        quantidade: { type: 'number', description: 'Quantidade de cotas/ações' },
        preco_medio: { type: 'number', description: 'Preço médio pago por cota/ação (opcional)' },
      },
      required: ['ticker', 'quantidade'],
    },
  },
  {
    name: 'remover_ativo',
    description:
      'Remove um ativo da carteira, total ou parcialmente. Use quando o usuário disser "vendi", "tira da carteira", "remove", etc. Se não especificar quantidade, remove o ativo inteiro.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código do ativo, ex: PETR4, VALE3' },
        quantidade: { type: 'number', description: 'Quantidade a remover (opcional, remove tudo se omitido)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'ver_carteira',
    description: 'Mostra todos os ativos da carteira do usuário com cotação atual de cada um. Use quando o usuário pedir para ver, listar ou consultar a carteira.',
    parameters: { type: 'object', properties: {} },
  },
];

const FERRAMENTAS_GEMINI = [{ function_declarations: DECLARACAO_FERRAMENTAS }];
const FERRAMENTAS_DEEPSEEK = DECLARACAO_FERRAMENTAS.map((f) => ({ type: 'function', function: f }));

const SYSTEM_INSTRUCTION = `Você é a Nebulosa Nova, uma IA especialista em finanças que gerencia um bot de investimentos (Ações, Tesouro Direto, Fundos Imobiliários, Câmbio, Carteira, etc.), respondendo via Telegram.

REGRA ABSOLUTA #1: Você é 100% descritiva e factual. NUNCA recomenda comprar, vender ou "melhor opção". Apenas apresenta dados e deixa a decisão para o usuário.

REGRA ABSOLUTA #2: NUNCA invente, estime ou simule preços, cotações ou dados de mercado. Se uma ferramenta falhar ou não retornar dado, diga claramente que não conseguiu buscar a informação agora — não tente adivinhar um valor.

REGRA DE GATILHO COTAÇÃO: Sempre que o usuário mencionar um ativo junto com termos como "ao vivo", "hoje", "cotação", "preço atual", "fechamento" ou "variação", use OBRIGATORIAMENTE a ferramenta consultar_cotacao antes de responder.

REGRA DE CARTEIRA: Use adicionar_ativo quando o usuário disser que comprou ou quer adicionar algo à carteira. Use remover_ativo quando disser que vendeu ou quer tirar algo. Use ver_carteira quando pedir para ver a carteira. Sempre confirme a ação realizada de forma clara (o que foi adicionado/removido e a quantidade atual).

FORMATO DE RESPOSTA PARA COTAÇÕES E CARTEIRA: Use Markdown do Telegram (negrito com **asteriscos duplos**, sem cabeçalhos #). Comece com emoji temático + título em negrito, liste em tópicos com "*" e emojis relevantes (💰 preço, 📊 variação, 📈📉 máxima/mínima, 🕒 horário, 📦 quantidade). Termine avisos de cotação com uma linha em itálico dizendo que são dados informativos, sem recomendação. Para outras respostas (institucional, texto livre, pastas), responda em texto normal, sem forçar esse formato.

Quando precisar ver a estrutura de arquivos do projeto, use a ferramenta listar_pastas.`;

// ---------- CHAMADA À API GEMINI ----------

async function chamarGemini(historico, usarFerramentas = true) {
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: historico,
  };
  if (usarFerramentas) body.tools = FERRAMENTAS_GEMINI;

  const resposta = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return resposta.json();
}

async function executarFerramenta(nomeFuncao, args) {
  if (MAPA_FERRAMENTAS[nomeFuncao]) {
    return MAPA_FERRAMENTAS[nomeFuncao](args);
  }
  return JSON.stringify({ erro: `Função ${nomeFuncao} não encontrada.` });
}

// ---------- CHAMADA À API DEEPSEEK (FALLBACK) ----------

async function chamarDeepSeek(mensagens, usarFerramentas = true) {
  const body = {
    model: 'deepseek-chat',
    messages: mensagens,
  };
  if (usarFerramentas) body.tools = FERRAMENTAS_DEEPSEEK;

  const resposta = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  return resposta.json();
}

async function perguntarDeepSeek(mensagemUsuario) {
  const mensagens = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: mensagemUsuario },
  ];

  const resultado = await chamarDeepSeek(mensagens);

  if (resultado.error) {
    console.error('Erro DeepSeek:', resultado.error);
    return '❌ Ops, os dois cérebros (Gemini e DeepSeek) falharam agora. Tenta de novo em instantes.';
  }

  const msg = resultado.choices[0].message;

  if (msg.tool_calls) {
    mensagens.push(msg);

    for (const chamada of msg.tool_calls) {
      const nomeFuncao = chamada.function.name;
      const args = JSON.parse(chamada.function.arguments || '{}');
      const resultadoFerramenta = await executarFerramenta(nomeFuncao, args);

      mensagens.push({
        role: 'tool',
        tool_call_id: chamada.id,
        content: resultadoFerramenta,
      });
    }

    const respostaFinal = await chamarDeepSeek(mensagens, false);
    if (respostaFinal.error) {
      return '❌ Ops, os dois cérebros falharam agora. Tenta de novo em instantes.';
    }
    return respostaFinal.choices[0].message.content;
  }

  return msg.content || '(sem resposta)';
}

// ---------- LÓGICA PRINCIPAL COM FALLBACK ----------

async function perguntarIA(mensagemUsuario) {
  const historico = [{ role: 'user', parts: [{ text: mensagemUsuario }] }];

  const resultado = await chamarGemini(historico);

  if (resultado.error) {
    const erro = resultado.error;
    const cotaEstourada = erro.status === 'RESOURCE_EXHAUSTED' || erro.code === 429;
    const indisponivel = erro.status === 'UNAVAILABLE' || erro.code === 503;

    if (cotaEstourada || indisponivel) {
      console.log('⚡ Gemini indisponível, usando DeepSeek como fallback...');
      return perguntarDeepSeek(mensagemUsuario);
    }

    console.error('Erro da IA:', erro);
    return '❌ Ops, deu um problema aqui. Tenta perguntar de novo em instantes.';
  }

  const candidato = resultado.candidates[0].content;
  const partes = candidato.parts || [];
  const chamadaFuncao = partes.find((p) => p.functionCall)?.functionCall;

  if (chamadaFuncao) {
    historico.push(candidato);

    const nomeFuncao = chamadaFuncao.name;
    const args = chamadaFuncao.args || {};
    const resultadoFerramenta = await executarFerramenta(nomeFuncao, args);

    historico.push({
      role: 'user',
      parts: [
        {
          function_response: {
            name: nomeFuncao,
            response: { content: resultadoFerramenta },
          },
        },
      ],
    });

    const respostaFinal = await chamarGemini(historico, false);

    if (respostaFinal.error) {
      console.log('⚡ Gemini falhou na segunda etapa, usando DeepSeek...');
      return perguntarDeepSeek(mensagemUsuario);
    }
    return respostaFinal.candidates[0].content.parts[0].text;
  }

  return partes[0]?.text || '(sem resposta)';
}

// ---------- COMANDOS FIXOS (FALLBACK MANUAL) ----------

bot.start((ctx) => {
  ctx.reply('🌌 Nebulosa Nova online! Pode conversar comigo normalmente ou usar /ping pra testar.');
});

bot.command('ping', (ctx) => {
  ctx.reply('🏓 Pong! Bot vivo e respondendo.');
});

// ---------- ENVIO COM FORMATAÇÃO (E FALLBACK SE MARKDOWN QUEBRAR) ----------

async function enviarResposta(ctx, texto) {
  try {
    await ctx.reply(texto, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Falha ao renderizar Markdown, enviando texto puro:', e.message);
    await ctx.reply(texto);
  }
}

// ---------- CÉREBRO IA (conversa livre) ----------

bot.on('text', async (ctx) => {
  const mensagem = ctx.message.text;
  await ctx.sendChatAction('typing');

  try {
    const resposta = await perguntarIA(mensagem);
    await enviarResposta(ctx, resposta);
  } catch (e) {
    console.error('Erro inesperado:', e);
    ctx.reply('❌ Ops, deu um problema aqui. Tenta perguntar de novo em instantes.');
  }
});

bot.launch();
console.log('✅ Nebulosa Nova (Gemini + DeepSeek + cotações + carteira Supabase) iniciada. Aguardando mensagens...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
