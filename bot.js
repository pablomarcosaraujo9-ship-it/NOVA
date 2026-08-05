require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const BRAPI_TOKEN = process.env.BRAPI_API_KEY;
const MARKETAUX_TOKEN = process.env.MARKETAUX_API_KEY;

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

function normalizarTicker(ticker) {
  let tickerFinal = ticker.toUpperCase().trim();

  const CRIPTO_MAP = {
    BITCOIN: 'BTC-USD',
    BTC: 'BTC-USD',
    ETHEREUM: 'ETH-USD',
    ETH: 'ETH-USD',
    SOLANA: 'SOL-USD',
    SOL: 'SOL-USD',
    DOGECOIN: 'DOGE-USD',
    DOGE: 'DOGE-USD',
    XRP: 'XRP-USD',
    CARDANO: 'ADA-USD',
    ADA: 'ADA-USD',
  };

  if (tickerFinal === 'USD-BRL' || tickerFinal === 'USDBRL' || tickerFinal === 'DOLAR') {
    return 'USDBRL=X';
  }
  if (CRIPTO_MAP[tickerFinal]) {
    return CRIPTO_MAP[tickerFinal];
  }
  if (!tickerFinal.includes('.') && !tickerFinal.includes('=') && !tickerFinal.includes('-') && /^[A-Z]{4}\d{1,2}$/.test(tickerFinal)) {
    return `${tickerFinal}.SA`;
  }
  return tickerFinal;
}

async function consultarCotacao(ticker) {
  try {
    const tickerFinal = normalizarTicker(ticker);

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

async function consultarTesouro(nomeTitulo) {
  try {
    if (!BRAPI_TOKEN) {
      return JSON.stringify({ erro: 'Chave da Brapi não configurada.' });
    }

    const url = `https://brapi.dev/api/v2/treasury/list`;
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${BRAPI_TOKEN}` },
    });
    const dados = await resposta.json();

    if (!resposta.ok || dados.error) {
      return JSON.stringify({
        erro: 'Consulta ao Tesouro Direto indisponível no plano atual da fonte de dados.',
      });
    }

    const lista = dados.titulos || dados.results || dados.data || [];
    const termoBusca = nomeTitulo.toLowerCase();

    const encontrados = lista.filter((t) =>
      (t.nome || t.name || '').toLowerCase().includes(termoBusca)
    );

    if (encontrados.length === 0) {
      return JSON.stringify({
        erro: `Nenhum título encontrado para "${nomeTitulo}".`,
      });
    }

    return JSON.stringify({ titulos_encontrados: encontrados.slice(0, 5) });
  } catch (e) {
    return JSON.stringify({ erro: 'Consulta ao Tesouro Direto indisponível no momento.' });
  }
}

async function consultarFundamentos(ticker) {
  try {
    if (!BRAPI_TOKEN) {
      return JSON.stringify({ erro: 'Chave da Brapi não configurada.' });
    }

    const tickerFinal = ticker.toUpperCase().trim().replace('.SA', '');

    const url = `https://brapi.dev/api/quote/${tickerFinal}?fundamental=true&modules=balanceSheetHistory,defaultKeyStatistics,financialData`;
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${BRAPI_TOKEN}` },
    });
    const dados = await resposta.json();

    if (!resposta.ok || dados.error || !dados.results || dados.results.length === 0) {
      return JSON.stringify({
        erro: `Não foi possível obter dados fundamentalistas de ${tickerFinal}. ${dados.message || ''}`,
      });
    }

    const r = dados.results[0];
    const bal = r.balanceSheetHistory?.balanceSheetStatements?.[0] || {};
    const stats = r.defaultKeyStatistics || {};
    const fin = r.financialData || {};

    return JSON.stringify({
      ticker: tickerFinal,
      nome: r.shortName || r.longName,
      preco_atual: r.regularMarketPrice,
      pl: r.priceEarnings ?? stats.trailingPE ?? null,
      lpa: r.earningsPerShare ?? stats.trailingEps ?? null,
      dividend_yield: stats.dividendYield ?? null,
      divida_liquida: fin.totalDebt ?? bal.totalLiab ?? null,
      ebitda: fin.ebitda ?? null,
      divida_liquida_ebitda:
        fin.totalDebt && fin.ebitda ? (fin.totalDebt / fin.ebitda).toFixed(2) : null,
      roe: fin.returnOnEquity ?? null,
      margem_liquida: fin.profitMargins ?? null,
      valor_mercado: stats.marketCap ?? r.marketCap ?? null,
    });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao consultar dados fundamentalistas: ${e.message}` });
  }
}

function parseRSS(xml) {
  const itens = [];
  const blocos = xml.split('<item>').slice(1);
  for (const bloco of blocos.slice(0, 10)) {
    const tituloMatch = bloco.match(/<title>([\s\S]*?)<\/title>/);
    const pubDateMatch = bloco.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = bloco.match(/<source[^>]*>([\s\S]*?)<\/source>/);

    if (tituloMatch) {
      let titulo = tituloMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      itens.push({
        titulo,
        fonte: sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null,
        data: pubDateMatch ? pubDateMatch[1].trim() : null,
      });
    }
  }
  return itens;
}

async function consultarNoticiasGoogleNews(termoBusca) {
  try {
    const query = encodeURIComponent(`${termoBusca} when:2d`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-BR`;

    const resposta = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const xml = await resposta.text();

    const noticias = parseRSS(xml);

    if (noticias.length === 0) {
      return JSON.stringify({ erro: `Nenhuma notícia recente (últimos 2 dias) encontrada para "${termoBusca}".` });
    }

    return JSON.stringify({ termo_busca: termoBusca, fonte: 'Google News', noticias });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao buscar notícias: ${e.message}` });
  }
}

async function consultarNoticiasMarketAux(termoBusca) {
  try {
    if (!MARKETAUX_TOKEN) {
      return null;
    }

    const params = new URLSearchParams({
      search: termoBusca,
      language: 'pt,en',
      limit: '10',
      api_token: MARKETAUX_TOKEN,
    });

    const url = `https://api.marketaux.com/v1/news/all?${params.toString()}`;
    const resposta = await fetch(url);
    const dados = await resposta.json();

    if (!resposta.ok || dados.error) {
      console.error('MarketAux indisponível:', dados.error || resposta.statusText);
      return null;
    }

    if (!dados.data || dados.data.length === 0) {
      return null;
    }

    const noticias = dados.data.slice(0, 8).map((n) => ({
      titulo: n.title,
      fonte: n.source,
      data: n.published_at,
      sentimento: n.entities?.[0]?.sentiment_score ?? null,
    }));

    return JSON.stringify({ termo_busca: termoBusca, fonte: 'MarketAux', noticias });
  } catch (e) {
    console.error('Erro MarketAux:', e.message);
    return null;
  }
}

async function consultarNoticias(termoBusca) {
  const resultadoMarketAux = await consultarNoticiasMarketAux(termoBusca);
  if (resultadoMarketAux) {
    return resultadoMarketAux;
  }
  console.log('⚡ MarketAux indisponível, usando Google News como fallback...');
  return consultarNoticiasGoogleNews(termoBusca);
}

function calcularRSI(precos, periodo = 14) {
  if (precos.length < periodo + 1) return null;
  let ganhos = 0;
  let perdas = 0;
  for (let i = precos.length - periodo; i < precos.length; i++) {
    const diff = precos[i] - precos[i - 1];
    if (diff > 0) ganhos += diff;
    else perdas += Math.abs(diff);
  }
  const mediaGanho = ganhos / periodo;
  const mediaPerda = perdas / periodo;
  if (mediaPerda === 0) return 100;
  const rs = mediaGanho / mediaPerda;
  return (100 - 100 / (1 + rs)).toFixed(2);
}

function calcularMediaMovel(precos, periodo) {
  if (precos.length < periodo) return null;
  const fatia = precos.slice(-periodo);
  const soma = fatia.reduce((acc, p) => acc + p, 0);
  return (soma / periodo).toFixed(2);
}

async function consultarAnaliseTecnica(ticker) {
  try {
    const tickerFinal = normalizarTicker(ticker);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${tickerFinal}?range=5y&interval=1d`;
    const resposta = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const dados = await resposta.json();

    if (dados.chart.error) {
      return JSON.stringify({ erro: `Ticker "${ticker}" não encontrado.` });
    }

    const resultado = dados.chart.result[0];
    const fechamentos = resultado.indicators.quote[0].close.filter((p) => p !== null);

    if (fechamentos.length < 50) {
      return JSON.stringify({ erro: `Histórico insuficiente para calcular indicadores de ${tickerFinal}.` });
    }

    const precoAtual = fechamentos[fechamentos.length - 1];
    const mm20 = calcularMediaMovel(fechamentos, 20);
    const mm50 = calcularMediaMovel(fechamentos, 50);
    const mm200 = fechamentos.length >= 200 ? calcularMediaMovel(fechamentos, 200) : null;
    const rsi14 = calcularRSI(fechamentos, 14);

    let sinalRSI = 'neutro';
    if (rsi14 !== null) {
      if (Number(rsi14) >= 70) sinalRSI = 'sobrecomprado';
      else if (Number(rsi14) <= 30) sinalRSI = 'sobrevendido';
    }

    const maxima5anos = Math.max(...fechamentos).toFixed(2);
    const minima5anos = Math.min(...fechamentos).toFixed(2);

    return JSON.stringify({
      ticker: tickerFinal,
      preco_atual: precoAtual.toFixed(2),
      media_movel_20d: mm20,
      media_movel_50d: mm50,
      media_movel_200d: mm200,
      rsi_14d: rsi14,
      sinal_rsi: sinalRSI,
      maxima_5_anos: maxima5anos,
      minima_5_anos: minima5anos,
      total_dias_historico: fechamentos.length,
    });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao calcular análise técnica: ${e.message}` });
  }
}

// ---------- GRÁFICO DE HISTÓRICO (QuickChart, gratuito) ----------

const PERIODOS_GRAFICO = {
  '1mo': { range: '1mo', interval: '1d', label: 'Últimos 30 dias' },
  '6mo': { range: '6mo', interval: '1wk', label: 'Últimos 6 meses' },
  '1a': { range: '1y', interval: '1wk', label: 'Último 1 ano' },
  '5a': { range: '5y', interval: '1mo', label: 'Últimos 5 anos' },
};

function gerarUrlQuickChart(ticker, datas, precos, periodoLabel) {
  const config = {
    type: 'line',
    data: {
      labels: datas,
      datasets: [
        {
          label: ticker,
          data: precos,
          fill: false,
          borderColor: 'rgb(75, 139, 235)',
          tension: 0.1,
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: `${ticker} — ${periodoLabel}`,
      },
    },
  };

  const configCodificado = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${configCodificado}&width=700&height=400`;
}

async function gerarGrafico({ ticker, periodo }) {
  try {
    const tickerFinal = normalizarTicker(ticker);
    const cfg = PERIODOS_GRAFICO[periodo] || PERIODOS_GRAFICO['1mo'];

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${tickerFinal}?range=${cfg.range}&interval=${cfg.interval}`;
    const resposta = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const dados = await resposta.json();

    if (dados.chart.error) {
      return JSON.stringify({ erro: `Ticker "${ticker}" não encontrado.` });
    }

    const resultado = dados.chart.result[0];
    const timestamps = resultado.timestamp;
    const fechamentos = resultado.indicators.quote[0].close;

    if (!timestamps || fechamentos.filter((p) => p !== null).length === 0) {
      return JSON.stringify({ erro: `Histórico não disponível para ${tickerFinal}.` });
    }

    const datas = [];
    const precos = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (fechamentos[i] !== null) {
        datas.push(new Date(timestamps[i] * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
        precos.push(Number(fechamentos[i].toFixed(2)));
      }
    }

    const urlGrafico = gerarUrlQuickChart(tickerFinal, datas, precos, cfg.label);

    return JSON.stringify({
      sucesso: true,
      ticker: tickerFinal,
      periodo: cfg.label,
      preco_inicial: precos[0],
      preco_final: precos[precos.length - 1],
      variacao_percentual: (((precos[precos.length - 1] - precos[0]) / precos[0]) * 100).toFixed(2),
      grafico_url: urlGrafico,
    });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao gerar gráfico: ${e.message}` });
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

    if (!quantidade || Number(quantidade) >= Number(existente.quantidade)) {
      const { error } = await supabase.from('portfolios').delete().eq('id', existente.id);
      if (error) return JSON.stringify({ erro: error.message });
      return JSON.stringify({ sucesso: true, acao: 'removido_completo', ticker: tickerFinal });
    }

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

// ---------- FERRAMENTAS DE ALERTAS (SUPABASE) ----------

async function criarAlerta({ ticker, percentual, condicao }, chatId) {
  try {
    if (!ticker || !percentual) {
      return JSON.stringify({ erro: 'Ticker e percentual são obrigatórios.' });
    }

    const tickerFinal = ticker.toUpperCase().trim();
    const condicaoFinal = condicao || 'qualquer';

    const cotacaoRaw = await consultarCotacao(tickerFinal);
    const cotacao = JSON.parse(cotacaoRaw);

    if (cotacao.erro || !cotacao.preco_atual) {
      return JSON.stringify({ erro: `Não foi possível obter o preço atual de ${tickerFinal} para criar o alerta.` });
    }

    const { error } = await supabase.from('alertas').insert({
      chat_id: String(chatId),
      ticker: tickerFinal,
      percentual: Math.abs(Number(percentual)),
      condicao: condicaoFinal,
      preco_base: cotacao.preco_atual,
      ativo: true,
    });

    if (error) return JSON.stringify({ erro: error.message });

    return JSON.stringify({
      sucesso: true,
      ticker: tickerFinal,
      percentual: Math.abs(Number(percentual)),
      condicao: condicaoFinal,
      preco_base: cotacao.preco_atual,
    });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao criar alerta: ${e.message}` });
  }
}

async function verAlertas(_args, chatId) {
  try {
    const { data, error } = await supabase
      .from('alertas')
      .select('*')
      .eq('chat_id', String(chatId))
      .eq('ativo', true);

    if (error) return JSON.stringify({ erro: error.message });

    if (!data || data.length === 0) {
      return JSON.stringify({ alertas: [], mensagem: 'Nenhum alerta ativo.' });
    }

    return JSON.stringify({
      alertas: data.map((a) => ({
        ticker: a.ticker,
        percentual: a.percentual,
        condicao: a.condicao,
        preco_base: a.preco_base,
        criado_em: a.created_at,
      })),
    });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao consultar alertas: ${e.message}` });
  }
}

async function removerAlerta({ ticker }, chatId) {
  try {
    if (!ticker) {
      return JSON.stringify({ erro: 'Ticker é obrigatório.' });
    }

    const tickerFinal = ticker.toUpperCase().trim();

    const { data, error } = await supabase
      .from('alertas')
      .delete()
      .eq('chat_id', String(chatId))
      .eq('ticker', tickerFinal)
      .eq('ativo', true)
      .select();

    if (error) return JSON.stringify({ erro: error.message });

    if (!data || data.length === 0) {
      return JSON.stringify({ erro: `Nenhum alerta ativo encontrado para ${tickerFinal}.` });
    }

    return JSON.stringify({ sucesso: true, ticker: tickerFinal, removidos: data.length });
  } catch (e) {
    return JSON.stringify({ erro: `Falha ao remover alerta: ${e.message}` });
  }
}

const MAPA_FERRAMENTAS = {
  listar_pastas: (args) => listarPastas(args.caminho),
  consultar_cotacao: (args) => consultarCotacao(args.ticker),
  consultar_tesouro: (args) => consultarTesouro(args.nome_titulo),
  consultar_fundamentos: (args) => consultarFundamentos(args.ticker),
  consultar_noticias: (args) => consultarNoticias(args.termo_busca),
  consultar_analise_tecnica: (args) => consultarAnaliseTecnica(args.ticker),
  gerar_grafico: (args) => gerarGrafico(args),
  adicionar_ativo: (args) => adicionarAtivo(args),
  remover_ativo: (args) => removerAtivo(args),
  ver_carteira: () => verCarteira(),
  criar_alerta: (args, chatId) => criarAlerta(args, chatId),
  ver_alertas: (args, chatId) => verAlertas(args, chatId),
  remover_alerta: (args, chatId) => removerAlerta(args, chatId),
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
      'Consulta a cotação atual (ao vivo) de um ativo: ações brasileiras (ex: PETR4, VALE3), Fundos Imobiliários - FIIs (ex: MXRF11, HGLG11), ações americanas (ex: AAPL, TSLA), ações internacionais com sufixo de bolsa (ex: 7203.T Tóquio, VOD.L Londres, MC.PA Paris, BMW.DE Frankfurt, 0700.HK Hong Kong), câmbio USD-BRL (use "USD-BRL") ou criptomoedas (ex: Bitcoin, Ethereum, BTC, ETH, Solana). Se o usuário mencionar uma empresa estrangeira sem especificar o ticker exato, tente primeiro o ticker mais conhecido (ex: ADR na NYSE) e, se fizer sentido, ofereça também consultar na bolsa local do país de origem. Use sempre que o usuário pedir cotação, preço atual, "ao vivo", "hoje", variação ou fechamento de um ativo, incluindo criptomoedas.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código ou nome do ativo, ex: PETR4, MXRF11, AAPL, USD-BRL, Bitcoin' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'consultar_tesouro',
    description:
      'Consulta títulos do Tesouro Direto (Tesouro Selic, Tesouro IPCA+, Tesouro Prefixado, etc), retornando taxas e preços atuais. Use quando o usuário perguntar sobre Tesouro Direto ou títulos públicos.',
    parameters: {
      type: 'object',
      properties: {
        nome_titulo: {
          type: 'string',
          description: 'Nome ou parte do nome do título, ex: "Selic", "IPCA", "Prefixado"',
        },
      },
      required: ['nome_titulo'],
    },
  },
  {
    name: 'consultar_fundamentos',
    description:
      'Consulta dados fundamentalistas de uma ação brasileira: P/L (preço/lucro), LPA, dividend yield, dívida líquida, EBITDA, dívida líquida/EBITDA, ROE, margem líquida e valor de mercado. Use quando o usuário pedir análise fundamentalista, indicadores financeiros, P/L, dívida, EBITDA ou fundamentos de uma empresa.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código da ação brasileira, ex: PETR4, VALE3' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'consultar_noticias',
    description:
      'Busca as notícias mais recentes sobre uma empresa, ativo ou tema de mercado, incluindo pontuação de sentimento (positivo/negativo) quando disponível. Use OBRIGATORIAMENTE quando o usuário perguntar "por que" um ativo subiu, caiu, ou pedir contexto/motivo por trás de uma variação de preço, ou pedir notícias sobre uma empresa/mercado.',
    parameters: {
      type: 'object',
      properties: {
        termo_busca: { type: 'string', description: 'Nome da empresa ou termo de busca, ex: "Petrobras", "Nvidia", "Ibovespa"' },
      },
      required: ['termo_busca'],
    },
  },
  {
    name: 'consultar_analise_tecnica',
    description:
      'Consulta indicadores de análise técnica de um ativo: médias móveis (20, 50 e 200 dias), RSI (Índice de Força Relativa, 14 dias) com sinal de sobrecomprado/sobrevendido, e máxima/mínima dos últimos 5 anos. Use quando o usuário pedir análise técnica, RSI, médias móveis, sobrecomprado, sobrevendido ou tendência técnica de um ativo.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código do ativo, ex: PETR4, VALE3, AAPL' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'gerar_grafico',
    description:
      'Gera um gráfico visual (imagem) do histórico de preços de um ativo. Use quando o usuário pedir "gráfico", "histórico de preços", "trajetória", "evolução do preço" ou similar.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código do ativo, ex: PETR4, AAPL, Bitcoin' },
        periodo: {
          type: 'string',
          enum: ['1mo', '6mo', '1a', '5a'],
          description: 'Período do gráfico: 1mo (30 dias), 6mo (6 meses), 1a (1 ano) ou 5a (5 anos). Padrão: 1mo se o usuário não especificar.',
        },
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
  {
    name: 'criar_alerta',
    description:
      'Cria um alerta de variação de preço para um ativo. O bot avisa automaticamente quando o preço variar o percentual definido, sem o usuário precisar perguntar. Use quando o usuário disser "me avisa se", "me alerta se", "cria um alerta", etc. Exemplo: "me alerta se PETR4 subir 5%".',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código do ativo, ex: PETR4, HSBC, MXRF11' },
        percentual: { type: 'number', description: 'Percentual de variação para disparar o alerta, ex: 5, 10' },
        condicao: {
          type: 'string',
          enum: ['subiu', 'desceu', 'qualquer'],
          description: 'Direção do alerta: "subiu" (só alta), "desceu" (só queda) ou "qualquer" (qualquer direção)',
        },
      },
      required: ['ticker', 'percentual', 'condicao'],
    },
  },
  {
    name: 'ver_alertas',
    description: 'Lista todos os alertas de preço ativos do usuário. Use quando o usuário pedir para ver ou listar seus alertas.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'remover_alerta',
    description: 'Remove um alerta de preço ativo. Use quando o usuário disser "cancela o alerta", "remove o alerta", etc.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Código do ativo do alerta a remover' },
      },
      required: ['ticker'],
    },
  },
];

const FERRAMENTAS_GEMINI = [{ function_declarations: DECLARACAO_FERRAMENTAS }];
const FERRAMENTAS_DEEPSEEK = DECLARACAO_FERRAMENTAS.map((f) => ({ type: 'function', function: f }));

const SYSTEM_INSTRUCTION = `Você é a Nebulosa Nova 🌌, uma IA especialista em finanças que gerencia um bot de investimentos (Ações, Tesouro Direto, Fundos Imobiliários, Câmbio, Criptomoedas, Análise Fundamentalista, Análise Técnica, Gráficos, Notícias, Carteira, Alertas de Preço, etc.), respondendo via Telegram.

REGRA ABSOLUTA #1: Você é 100% descritiva e factual. NUNCA recomenda comprar, vender ou "melhor opção". Apenas apresenta dados e deixa a decisão para o usuário.

REGRA ABSOLUTA #2: NUNCA invente, estime ou simule preços, cotações ou dados de mercado. Se uma ferramenta falhar ou não retornar dado, diga claramente que não conseguiu buscar a informação agora — não tente adivinhar um valor.

REGRA ABSOLUTA #3 (NOTÍCIAS): Ao explicar por que um ativo subiu ou caiu, baseie-se SOMENTE nas manchetes retornadas pela ferramenta consultar_noticias. Nunca afirme uma causa com certeza absoluta — sempre atribua a fontes ("segundo as notícias mais recentes...", "manchetes recentes mencionam..."). Se não houver notícias relevantes, diga isso claramente em vez de especular. Se a ferramenta retornar um score de sentimento, você pode mencioná-lo como contexto adicional (ex: "sentimento predominante positivo/negativo segundo as fontes"), mas não o trate como certeza sobre o motivo da variação de preço.

REGRA DE GATILHO COTAÇÃO: Sempre que o usuário mencionar um ativo (incluindo criptomoedas) junto com termos como "ao vivo", "hoje", "cotação", "preço atual", "fechamento" ou "variação", use OBRIGATORIAMENTE a ferramenta consultar_cotacao antes de responder.

REGRA DE TESOURO: Sempre que o usuário perguntar sobre Tesouro Direto ou títulos públicos, use OBRIGATORIAMENTE a ferramenta consultar_tesouro antes de responder. Se a ferramenta retornar erro de indisponibilidade, informe educadamente que essa consulta específica não está disponível no momento.

REGRA DE FUNDAMENTOS: Sempre que o usuário pedir P/L, dívida/EBITDA, indicadores financeiros ou análise fundamentalista de uma ação, use OBRIGATORIAMENTE a ferramenta consultar_fundamentos antes de responder. Apenas apresente os números — não interprete se estão "bons" ou "ruins", nem sugira decisões a partir deles.

REGRA DE NOTÍCIAS: Sempre que o usuário perguntar "por que" um ativo subiu/caiu, ou pedir contexto/motivo de uma variação, ou pedir notícias sobre uma empresa, use OBRIGATORIAMENTE a ferramenta consultar_noticias. Resuma os principais pontos das manchetes de forma clara, sempre deixando claro que é com base no noticiário recente.

REGRA DE ANÁLISE TÉCNICA: Sempre que o usuário pedir RSI, médias móveis, sobrecomprado/sobrevendido ou análise técnica de um ativo, use OBRIGATORIAMENTE a ferramenta consultar_analise_tecnica. Apresente os números tal como vieram — não interprete como sinal de compra/venda, apenas descreva o que os indicadores mostram tecnicamente.

REGRA DE GRÁFICO: Sempre que o usuário pedir gráfico, histórico de preços, trajetória ou evolução de um ativo, use OBRIGATORIAMENTE a ferramenta gerar_grafico. A imagem será enviada automaticamente pelo sistema — na sua resposta em texto, apenas comente brevemente a variação do período (preço inicial vs final), sem repetir que "segue o gráfico" (isso é redundante, a imagem já aparece).

REGRA DE CARTEIRA: Use adicionar_ativo quando o usuário disser que comprou ou quer adicionar algo à carteira. Use remover_ativo quando disser que vendeu ou quer tirar algo. Use ver_carteira quando pedir para ver a carteira. Sempre confirme a ação realizada de forma clara (o que foi adicionado/removido e a quantidade atual).

REGRA DE ALERTAS: Use criar_alerta quando o usuário pedir para ser avisado sobre variação de preço (ex: "me alerta se X subir Y%"). Se o usuário não especificar a direção (subiu/desceu), pergunte antes de criar, ou use "qualquer" se o contexto deixar claro que é qualquer direção. Use ver_alertas para listar, remover_alerta para cancelar. Sempre confirme os detalhes do alerta criado (ativo, percentual, direção).

FORMATO DE RESPOSTA (OBRIGATÓRIO PARA TODAS AS RESPOSTAS, SEM EXCEÇÃO): Siga SEMPRE esta estrutura visual usando Markdown do Telegram:

1. Comece com um emoji temático + título em **negrito** relacionado ao assunto (ex: "📰 **Contexto de Mercado: PETR4**", "💰 **Cotação Bitcoin**", "🔔 **Alerta Criado**").
2. Se houver uma explicação textual antes dos tópicos, escreva em texto corrido normal.
3. Liste os pontos principais em tópicos usando " * " seguido de um emoji relevante e o rótulo em **negrito** (💰 preço, 📊 variação, 📈📉 alta/baixa, 🕒 horário, 📦 quantidade, 📐 indicadores, 🔔 alerta, 📰 notícia, 🏢 empresa, 🏦 institucional).
4. Se fizer sentido, adicione uma linha de ressalva/contexto adicional com emoji apropriado (ex: "⚖️ É importante notar que...").
5. SEMPRE termine com o aviso legal em formato de citação em bloco do Telegram, começando a linha com ">" seguido de "⚠️" e o texto em itálico. Exemplo exato: "> ⚠️ *Estes são dados informativos, sem qualquer recomendação de investimento.*"

Aplique essa estrutura em TODAS as respostas — cotações, tesouro, fundamentos, notícias, análise técnica, gráficos, carteira, alertas e também respostas institucionais/conversas gerais, adaptando os emojis ao contexto.

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

async function executarFerramenta(nomeFuncao, args, chatId) {
  if (MAPA_FERRAMENTAS[nomeFuncao]) {
    return MAPA_FERRAMENTAS[nomeFuncao](args, chatId);
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

async function perguntarDeepSeek(mensagemUsuario, chatId) {
  const mensagens = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: mensagemUsuario },
  ];

  const resultado = await chamarDeepSeek(mensagens);

  if (resultado.error) {
    console.error('Erro DeepSeek:', resultado.error);
    return { texto: '❌ Ops, os dois cérebros (Gemini e DeepSeek) falharam agora. Tenta de novo em instantes.', graficoUrl: null };
  }

  const msg = resultado.choices[0].message;
  let graficoUrl = null;

  if (msg.tool_calls) {
    mensagens.push(msg);

    for (const chamada of msg.tool_calls) {
      const nomeFuncao = chamada.function.name;
      const args = JSON.parse(chamada.function.arguments || '{}');
      const resultadoFerramenta = await executarFerramenta(nomeFuncao, args, chatId);

      if (nomeFuncao === 'gerar_grafico') {
        try {
          const parsed = JSON.parse(resultadoFerramenta);
          if (parsed.grafico_url) graficoUrl = parsed.grafico_url;
        } catch (e) {}
      }

      mensagens.push({
        role: 'tool',
        tool_call_id: chamada.id,
        content: resultadoFerramenta,
      });
    }

    const respostaFinal = await chamarDeepSeek(mensagens, false);
    if (respostaFinal.error) {
      return { texto: '❌ Ops, os dois cérebros falharam agora. Tenta de novo em instantes.', graficoUrl: null };
    }
    return { texto: respostaFinal.choices[0].message.content, graficoUrl };
  }

  return { texto: msg.content || '(sem resposta)', graficoUrl: null };
}

// ---------- LÓGICA PRINCIPAL COM FALLBACK ----------

async function perguntarIA(mensagemUsuario, chatId) {
  const historico = [{ role: 'user', parts: [{ text: mensagemUsuario }] }];

  const resultado = await chamarGemini(historico);

  if (resultado.error) {
    const erro = resultado.error;
    console.error('Erro Gemini (1ª etapa):', JSON.stringify(erro));

    const cotaEstourada = erro.status === 'RESOURCE_EXHAUSTED' || erro.code === 429;
    const indisponivel = erro.status === 'UNAVAILABLE' || erro.code === 503;

    if (cotaEstourada || indisponivel) {
      console.log('⚡ Gemini indisponível (1ª etapa), usando DeepSeek como fallback...');
      return perguntarDeepSeek(mensagemUsuario, chatId);
    }

    return { texto: '❌ Ops, deu um problema aqui. Tenta perguntar de novo em instantes.', graficoUrl: null };
  }

  const candidato = resultado.candidates[0].content;
  const partes = candidato.parts || [];
  const chamadasFuncao = partes.filter((p) => p.functionCall).map((p) => p.functionCall);

  if (chamadasFuncao.length > 0) {
    historico.push(candidato);

    const responseParts = [];
    let graficoUrl = null;

    for (const chamadaFuncao of chamadasFuncao) {
      const nomeFuncao = chamadaFuncao.name;
      const args = chamadaFuncao.args || {};
      const resultadoFerramenta = await executarFerramenta(nomeFuncao, args, chatId);

      if (nomeFuncao === 'gerar_grafico') {
        try {
          const parsed = JSON.parse(resultadoFerramenta);
          if (parsed.grafico_url) graficoUrl = parsed.grafico_url;
        } catch (e) {}
      }

      responseParts.push({
        function_response: {
          name: nomeFuncao,
          response: { content: resultadoFerramenta },
        },
      });
    }

    historico.push({
      role: 'user',
      parts: responseParts,
    });

    const respostaFinal = await chamarGemini(historico, false);

    if (respostaFinal.error) {
      const erro2 = respostaFinal.error;
      console.error('Erro Gemini (2ª etapa):', JSON.stringify(erro2));

      const cotaEstourada2 = erro2.status === 'RESOURCE_EXHAUSTED' || erro2.code === 429;
      const indisponivel2 = erro2.status === 'UNAVAILABLE' || erro2.code === 503;

      if (cotaEstourada2 || indisponivel2) {
        console.log('⚡ Gemini indisponível (2ª etapa), usando DeepSeek...');
        return perguntarDeepSeek(mensagemUsuario, chatId);
      }

      return { texto: '❌ Ops, deu um problema aqui. Tenta perguntar de novo em instantes.', graficoUrl: null };
    }
    return { texto: respostaFinal.candidates[0].content.parts[0].text, graficoUrl };
  }

  return { texto: partes[0]?.text || '(sem resposta)', graficoUrl: null };
}

// ---------- VERIFICADOR DE ALERTAS (RODA SOZINHO) ----------

async function verificarAlertas() {
  try {
    const { data: alertas, error } = await supabase.from('alertas').select('*').eq('ativo', true);

    if (error || !alertas || alertas.length === 0) return;

    for (const alerta of alertas) {
      const cotacaoRaw = await consultarCotacao(alerta.ticker);
      const cotacao = JSON.parse(cotacaoRaw);

      if (cotacao.erro || !cotacao.preco_atual) continue;

      const precoAtual = cotacao.preco_atual;
      const precoBase = Number(alerta.preco_base);
      const variacao = ((precoAtual - precoBase) / precoBase) * 100;
      const variacaoAbs = Math.abs(variacao);

      let disparou = false;
      if (alerta.condicao === 'subiu' && variacao >= alerta.percentual) disparou = true;
      if (alerta.condicao === 'desceu' && variacao <= -alerta.percentual) disparou = true;
      if (alerta.condicao === 'qualquer' && variacaoAbs >= alerta.percentual) disparou = true;

      if (disparou) {
        const direcao = variacao >= 0 ? '📈 subiu' : '📉 desceu';
        const mensagem =
          `🔔 **Alerta disparado: ${alerta.ticker}**\n\n` +
          `* 💰 **Preço base:** ${precoBase}\n` +
          `* 💰 **Preço atual:** ${precoAtual}\n` +
          `* ${direcao} **${variacaoAbs.toFixed(2)}%** (alerta configurado para ${alerta.percentual}%)\n\n` +
          `> ⚠️ *Este é um alerta informativo, sem recomendação de compra ou venda.*`;

        try {
          await bot.telegram.sendMessage(alerta.chat_id, mensagem, { parse_mode: 'Markdown' });
        } catch (e) {
          console.error('Falha ao enviar alerta, tentando texto puro:', e.message);
          await bot.telegram.sendMessage(alerta.chat_id, mensagem.replace(/\*\*/g, '').replace(/\*/g, '').replace('> ', ''));
        }

        await supabase
          .from('alertas')
          .update({ ativo: false, disparado_at: new Date().toISOString() })
          .eq('id', alerta.id);
      }
    }
  } catch (e) {
    console.error('Erro ao verificar alertas:', e.message);
  }
}

// ---------- COMANDOS FIXOS (FALLBACK MANUAL) ----------

bot.start((ctx) => {
  ctx.reply('🌌 Nebulosa Nova online! Pode conversar comigo normalmente ou usar /ping pra testar.');
});

bot.command('ping', (ctx) => {
  ctx.reply('🏓 Pong! Bot vivo e respondendo.');
});

// ---------- ENVIO COM FORMATAÇÃO (TEXTO OU IMAGEM+LEGENDA) ----------

async function enviarResposta(ctx, texto, graficoUrl) {
  if (graficoUrl) {
    const legenda = texto.length > 1024 ? texto.slice(0, 1020) + '...' : texto;

    try {
      await ctx.replyWithPhoto(graficoUrl, { caption: legenda, parse_mode: 'Markdown' });
      return;
    } catch (e) {
      console.error('Falha ao enviar gráfico com Markdown, tentando sem formatação:', e.message);
    }

    try {
      const legendaLimpa = legenda.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^>\s*/gm, '');
      await ctx.replyWithPhoto(graficoUrl, { caption: legendaLimpa });
      return;
    } catch (e) {
      console.error('Falha ao enviar gráfico mesmo sem formatação:', e.message);
    }
  }

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
  const chatId = ctx.chat.id;
  await ctx.sendChatAction('typing');

  try {
    const { texto, graficoUrl } = await perguntarIA(mensagem, chatId);
    await enviarResposta(ctx, texto, graficoUrl);
  } catch (e) {
    console.error('Erro inesperado:', e);
    ctx.reply('❌ Ops, deu um problema aqui. Tenta perguntar de novo em instantes.');
  }
});

bot.launch();
console.log('✅ Nebulosa Nova (Gemini + DeepSeek + cotações + cripto + fundamentos + notícias MarketAux/GoogleNews + análise técnica + gráficos + carteira + alertas) iniciada. Aguardando mensagens...');

setInterval(verificarAlertas, 15 * 60 * 1000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
