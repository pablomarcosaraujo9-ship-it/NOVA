# 🌌 Nebulosa Nova - Bot de Investimentos com IA

**Bot de Telegram com IA orquestradora para acompanhamento de mercado financeiro.**
Conversa em linguagem natural — sem comandos fixos, a IA decide sozinha qual ferramenta usar via function calling.

**Autor:** [@pablomarcosaraujo9](https://github.com/pablomarcosaraujo9-ship-it)
**Última atualização:** Agosto/2026

---

## 🧠 Como funciona

Em vez de decorar comandos, você simplesmente conversa:

> "Cotação da PETR4 ao vivo"
> "Comprei 10 ações da VALE3 a 76 reais"
> "Por que a NVIDIA subiu hoje?"
> "Me alerta se o Bitcoin cair 10%"
> "Gráfico da PETR4 dos últimos 6 meses"

A IA (Gemini como principal, DeepSeek como fallback automático) interpreta o pedido e chama a ferramenta certa sozinha.

---

## 📌 Funcionalidades

| Recurso | Descrição | Fonte de dados | Status |
|---|---|---|---|
| 💰 Cotação ao vivo | Ações BR/EUA/globais (Tóquio, Londres, Paris, Frankfurt, Hong Kong), FIIs, câmbio USD-BRL, criptomoedas | Yahoo Finance (grátis) | ✅ |
| 📊 Análise comparativa | Compara múltiplos ativos na mesma consulta | Yahoo Finance | ✅ |
| 📐 Análise fundamentalista | P/L, LPA, dividend yield, dívida líquida/EBITDA, ROE, margem líquida | Brapi | ✅ |
| 📈 Análise técnica | Médias móveis (20/50/200 dias), RSI com sinal de sobrecompra/sobrevenda | Yahoo Finance | ✅ |
| 🖼️ Gráficos de histórico | Imagem de gráfico de preço (30 dias a 5 anos) | Yahoo Finance + QuickChart | ✅ |
| 📰 Notícias com sentimento | Notícias recentes por empresa/ativo, com pontuação de sentimento | MarketAux (fallback: Google News RSS) | ✅ |
| 💼 Carteira persistente | Adicionar, remover e visualizar ativos com cotação atual | Supabase | ✅ |
| 🔔 Alertas de preço | Avisa automaticamente quando um ativo variar X% (configurável por chat) | Supabase + verificação a cada 15 min | ✅ |
| 🏦 Tesouro Direto | Consulta de títulos públicos | Brapi | ⛔ Bloqueado — exige plano Pro pago |

---

## 🧱 Arquitetura

    Telegram → bot.js (IA orquestradora) → Ferramentas (function calling)
                    ↓
        ┌───────────┼───────────┬──────────────┬───────────┐
      Gemini      DeepSeek     Yahoo         Brapi      Supabase
    (principal) (fallback)   Finance    (fundamentos    (carteira
                            (cotações,   + tesouro*)    + alertas)
                           gráficos,
                         análise técnica)
                                            MarketAux
                                         (notícias, fallback
                                          Google News RSS)

*Tesouro Direto: bloqueado no plano gratuito da Brapi, exige plano Pro.

- **Arquivo único** (`bot.js`) — sem módulos separados, tudo orquestrado pela IA via function calling
- **Sem SDKs pesados** — todas as APIs são chamadas via `fetch` nativo do Node, evitando dependências que falham ao compilar no Termux (ex: `openai` oficial quebra por causa do pacote `jiter`/Rust)
- **Cérebro principal**: `gemini-3.1-flash-lite` — escolhido por ter cota gratuita diária bem maior que `gemini-3.5-flash` (que caiu para 20 req/dia no free tier em dez/2025)
- **Fallback automático**: DeepSeek (`deepseek-chat`) ativa sozinho quando o Gemini retorna erro de cota (429/`RESOURCE_EXHAUSTED`) ou indisponibilidade (503/`UNAVAILABLE`)

---

## 🎯 Regras inegociáveis do produto

1. A IA é **100% descritiva e factual** — nunca recomenda compra/venda/"melhor opção"
2. **Nunca inventa, estima ou simula** preços ou dados de mercado — se uma ferramenta falha, admite que não conseguiu buscar
3. Ao explicar variações de preço via notícias, **sempre atribui a fontes** ("segundo notícias recentes..."), nunca afirma causa com certeza absoluta

Todas as respostas seguem formato visual padronizado: emoji + título em negrito → tópicos com emoji e negrito → linha de contexto/ressalva quando aplicável → aviso legal em blockquote no final.

---

## 🖥️ Onde roda

- **Servidor**: Termux (Android), processo mantido 24/7 via PM2
- **Nome do processo PM2**: `NebulosaNova`

### Atualizar o bot depois de mudanças no GitHub:

    cd ~/NOVA
    git pull
    npm install
    pm2 restart NebulosaNova

### Se o bot cair (Termux fechado/sem internet):

    pm2 status
    cd ~/NOVA
    pm2 start bot.js --name NebulosaNova
    pm2 save

---

## 🔑 Variáveis de ambiente (.env, nunca commitado)

    BOT_TOKEN=              # Token do bot no Telegram (BotFather)
    GEMINI_API_KEY=         # Google AI Studio
    DEEPSEEK_API_KEY=       # platform.deepseek.com
    SUPABASE_URL=           # URL do projeto Supabase
    SUPABASE_SERVICE_KEY=   # Chave service_role (nunca a anon)
    BRAPI_API_KEY=          # brapi.dev
    MARKETAUX_API_KEY=      # marketaux.com

---

## 🗄️ Banco de dados (Supabase)

- **Projeto**: `nova-bo` (ID: `falrhiasebnbekuvqqcv`)
- **Tabelas**:
  - `portfolios` — ticker, quantidade, preco_medio
  - `alertas` — ticker, percentual, condicao, preco_base, ativo, chat_id
- RLS ativado em ambas, sem policies — o bot usa a `service_role` key (bypassa RLS), nunca a `anon` key

---

## 📁 Estrutura de arquivos

    NOVA/
    ├── bot.js              # Arquivo único: IA + todas as ferramentas
    ├── .env                # Chaves (local, nunca commitado)
    ├── .env.example         # Modelo sem chaves reais
    ├── .gitignore
    ├── package.json
    └── README.md            # Este arquivo

---

## ⚠️ Riscos conhecidos / pontos de atenção

- **Termux pode ser morto pelo Android** (gerenciamento agressivo de bateria) — derruba o PM2. Mitigação parcial: desativar otimização de bateria para o Termux nas configurações do Android. Solução completa pendente: configurar **Termux:Boot**.
- **Sempre commitar no GitHub após mudanças** no `bot.js` — já houve perda de progresso por mudanças feitas localmente sem commit.
- Cotas gratuitas de APIs externas podem mudar sem aviso (já aconteceu com o Gemini em dez/2025).
- MarketAux free tier: 100 requisições/dia — cada pergunta de notícia consome 1 chamada.

---

## 🔮 Pendências / ideias futuras

- [ ] Configurar Termux:Boot para recuperação automática após reboot do celular
- [ ] Avaliar se vale pagar plano da Brapi para desbloquear Tesouro Direto
- [ ] Simulador de roleta HTML (projeto separado, não relacionado à Nebulosa Nova)

---

## ⚖️ Aviso legal

Este bot é uma ferramenta informativa. Todos os dados apresentados são factuais e descritivos — o bot **nunca** recomenda compra, venda ou qualquer decisão de investimento. Toda decisão de alocação deve ser feita pelo usuário, diretamente com sua corretora.
