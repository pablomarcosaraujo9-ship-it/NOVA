# 🌌 Nebulosa Nova - Bot de Investimentos com IA

**Bot de Telegram com IA orquestradora para acompanhamento de mercado financeiro.**
Conversa em linguagem natural — sem comandos fixos, a IA decide sozinha qual ferramenta usar.

**Autor:** [@pablomarcosaraujo9](https://github.com/pablomarcosaraujo9-ship-it)

---

## 🧠 Como funciona

Em vez de decorar comandos (`/scanner`, `/investir`), você simplesmente conversa:

> "Cotação da PETR4 ao vivo"
> "Comprei 10 ações da VALE3 a 76 reais"
> "Por que a NVIDIA subiu hoje?"
> "Me alerta se o Bitcoin cair 10%"

A IA (Gemini, com fallback automático para DeepSeek) interpreta o pedido e chama a ferramenta certa sozinha, via function calling.

---

## 📌 Funcionalidades

| Recurso | Descrição | Fonte |
|---|---|---|
| 💰 **Cotação ao vivo** | Ações BR/EUA, bolsas internacionais (Tóquio, Londres, Paris, Frankfurt, Hong Kong), FIIs, câmbio USD-BRL, criptomoedas | Yahoo Finance (grátis) |
| 📊 **Análise comparativa** | Compara múltiplos ativos na mesma consulta | Yahoo Finance |
| 📐 **Análise fundamentalista** | P/L, LPA, dividend yield, dívida líquida/EBITDA, ROE, margem líquida | Brapi |
| 📈 **Análise técnica** | Médias móveis (20/50/200 dias), RSI com sinal de sobrecompra/sobrevenda | Yahoo Finance |
| 🖼️ **Gráficos de histórico** | Imagem de gráfico de preço (30 dias a 5 anos) | Yahoo Finance + QuickChart |
| 📰 **Notícias com sentimento** | Notícias recentes por empresa/ativo, com pontuação de sentimento | MarketAux (fallback: Google News) |
| 💼 **Carteira persistente** | Adicionar, remover e visualizar ativos com cotação atual | Supabase |
| 🔔 **Alertas de preço** | Avisa automaticamente quando um ativo variar X% (configurável) | Supabase + verificação a cada 15 min |

---

## 🧱 Arquitetura
