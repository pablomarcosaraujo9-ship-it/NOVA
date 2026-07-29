# 🤖 Bot NOVA - Telegram

**Bot de análise de ações, notícias e carteira para Telegram.**  
Feito em Node.js + Yahoo Finance API

**Autor:** [@pablomarcosaraujo9](https://github.com/pablomarcosaraujo9-ship-it)

---

## 📌 Funcionalidades

- Análise rápida de ativos com o comando `/nova PETR4.SA`
- Cotação em tempo real (Yahoo Finance)
- Notícias recentes e classificação automática de motivos (alta/baixa)
- Índices: IBOV, S&P500, Nasdaq, Dólar
- Carteira virtual: adicione, remova e acompanhe seus papéis
- Ranking de melhores ações do dia (`/investir`)
- Análise fundamentalista (P/L, DY, etc.) com `/scanner` (ativos do Brasil)
- Geração de gráficos via TradingView com `/grafico`
- Contexto de longo prazo (notícias dos últimos 6 meses) com `/longo`
- Cache inteligente para reduzir chamadas à API

---

## 🧠 Arquitetura & Fluxo

### Como funciona o comando `/nova PETR4.SA`

```mermaid
graph TD
    A[1. Usuário: nova PETR4] --> B[2. Telegram]
    B --> C[3. bot.js]
    C --> D[4. novaAnalise.js]
    D --> E{5. Cache existe em cache_nova/?}
    E -- Sim e < 3h --> H[8. Responde Usuário]
    E -- Não --> F[6. Busca API via mercado.js]
    F --> G[7. Processa e Salva Cache]
    G --> H
