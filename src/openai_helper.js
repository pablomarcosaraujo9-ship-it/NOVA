const OpenAI = require('openai');

// Inicializa o cliente OpenAI (versão 4.x)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function perguntarAoGPT(pergunta) {
    if (!process.env.OPENAI_API_KEY) {
        return "⚠️ Chave da OpenAI não configurada. Configure OPENAI_API_KEY no .env";
    }

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: `Você é um assistente financeiro especializado em investimentos. 
                              Responda de forma clara, objetiva e em português do Brasil. 
                              Não dê recomendações de compra/venda, apenas forneça informações educativas.`
                },
                { role: "user", content: pergunta }
            ],
            max_tokens: 500,
            temperature: 0.7,
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Erro na OpenAI:", error.message);
        return "❌ Erro ao processar sua pergunta. Tente novamente mais tarde.";
    }
}

module.exports = { perguntarAoGPT };
