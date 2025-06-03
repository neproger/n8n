import https from "https";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import pdfParse from "pdf-parse";
import { WeaviateService } from '../data-service/weaviate-service.js';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Метод для загрузки файла
async function downloadFile(ctx, fileId, fileName) {
    try {
        const link = await ctx.telegram.getFileLink(fileId)
        const file = await ctx.telegram.getFile(fileId);
        const filePath = file.file_path;
        // const fileUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${filePath}`;

        const downloadDir = path.join(process.cwd(), "downloads");
        await fs.mkdir(downloadDir, { recursive: true });

        const localFilePath = path.join(downloadDir, fileName);

        // Загрузка файла через https и сохранение через стрим
        await new Promise((resolve, reject) => {
            https.get(link, (res) => {
                const fileStream = createWriteStream(localFilePath);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close(resolve);
                });
                fileStream.on('error', reject);
            }).on('error', reject);
        });

        return localFilePath;
    } catch (error) {
        console.error("Ошибка при загрузке файла:", error.message);
        throw new Error("Не удалось загрузить файл.");
    }
}

async function downloadPhoto(ctx, fileUrl, fileName) {
    try {
        const downloadDir = path.join(process.cwd(), "downloads/photos");
        await fs.mkdir(downloadDir, { recursive: true });

        const localFilePath = path.join(downloadDir, fileName);

        // Загрузка файла через https и сохранение через стрим
        await new Promise((resolve, reject) => {
            https.get(fileUrl, (res) => {
                const fileStream = createWriteStream(localFilePath);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close(resolve);
                });
                fileStream.on('error', reject);
            }).on('error', reject);
        });

        console.log(`Файл сохранен: ${localFilePath}`);
        return localFilePath;
    } catch (error) {
        console.error("Ошибка при загрузке файла:", error.message);
        throw new Error("Не удалось загрузить файл.");
    }
}

// filePath — путь к PDF файлу, сохраненному на диске
export async function extractPdfText(filePath) {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
}

const weaviateService = new WeaviateService();
const client = await weaviateService.init();

// LLM ////////////////////////////////

const model = new ChatGoogleGenerativeAI(
    {
        model: "gemini-1.5-flash", //gemini-2.5-flash-preview-05-20 gemini-1.5-flash
        openAIApiKey: process.env.GOOGLE_API_KEY,
    }
);
async function semanticSearch(query) {
    // console.log('search_documents: ', query);

    // Отправляем ответ
    const response = await weaviateService.semanticSearch(query);
    // console.log('Результаты поиска:', JSON.stringify(response));
    return JSON.stringify(response);
}

async function getDocuments() {
    const collection = client.collections.get("Documents");
    console.log("getDocuments: запрос на получение документов");
    const documents = [];
    for await (const item of collection.iterator()) {
        documents.push({
            id: item.uuid,
            title: item.properties.title,
            url: item.properties.url,
            postedAt: item.properties.postedAt,
        });
    }
    return JSON.stringify(documents); // возвращаем массив как есть
}


const getDocumentsTool = tool(getDocuments, {
    name: "get_documents",
    description: `Получить все документы из коллекции Weaviate.
Оформи ответ в таком стиле:
1.  💾 title
    📆 postedAt
    📎 id

2.  💾 title
    📆 postedAt
    📎 id
`,
    schema: z.object({}),
});

// Создание агента
import { SystemMessage } from "@langchain/core/messages";
import { ConversationChain } from "langchain/chains";
import { BufferMemory } from "langchain/memory";

const llmWithTools = model.bindTools([getDocumentsTool]);

const memory = new BufferMemory();
await memory.chatHistory.addMessage(
    new SystemMessage("Ты умный русский помощник Иван."),
);
const chain = new ConversationChain({
    llm: llmWithTools,
    memory,
    schema: {
        content: "string",
        context: "string",
        response: "object",
    },
});
// LLM ////////////////////////////////////

async function toolsCallingAgent(tools) {
    for (const tool of tools) {
        if (typeof tool.functionCall === "object") {
            const toolName = tool.functionCall.name;

            if (toolName === "search") {
                return await semanticSearch(tool.functionCall.args.query);
            } else if (toolName === "get_documents") {
                return await getDocuments();
            }
        }
    }
    return null;
}

async function main() {
    bot.on("text", async (ctx) => {
        try {
            const message = ctx.message.text;
            console.log("Я: " + message);
            const context = await semanticSearch(message);
            const response = await chain.invoke({
                input: {
                    content: message,
                    context: context,
                }
            });

            const aiMessage = response.response ? response.response : "Я не знаю, что ответить на это сообщение."
            if (aiMessage.trim().startsWith('[')) {
                try {
                    const tools = JSON.parse(aiMessage);
                    
                    const toolContext = await toolsCallingAgent(tools);
                    const response = await chain.call({
                        input: {
                            content: "",
                            context: "",
                        }
                    });
                    console.log("toolContext:", toolContext);
                    console.log("Результат вызова инструмента:", response);
                    ctx.reply(response.response);
                } catch (err) {
                    console.error("Ошибка при разборе ответа LLM:", err);
                    ctx.reply("Произошла ошибка при обработке ответа. Попробуйте еще раз.");
                }
            } else {
                console.log("ЛЛМ: " + aiMessage);
                ctx.reply(aiMessage);
            }
        } catch (error) {
            console.error("Ошибка при обработке сообщения:", error);
            ctx.reply("Произошла ошибка. Попробуйте еще раз.");
        }
    });
    // Обработчик документов
    bot.on("document", async (ctx) => {
        try {
            const fileId = ctx.message.document.file_id;
            const fileName = ctx.message.document.file_name || `document_${ctx.message.message_id}`;
            const mime_type = ctx.message.document.mime_type;
            const ext = path.extname(fileName).slice(1);



            // Загружаем файл
            const localFilePath = await downloadFile(ctx, fileId, fileName);

            // Отправляем подтверждение пользователю
            const message = `Файл "${fileName}" Расширение: ${ext}`;
            console.log(message);
            ctx.reply(message);

            if (ext == 'txt' || ext == 'md' || ext == 'ini') {
                // Обработка текстовых файлов
                const text = await fs.readFile(localFilePath, 'utf-8');

                const doc = await weaviateService.addObject({
                    content: text,
                    url: localFilePath,
                    title: fileName,
                    postedAt: new Date().toISOString(),
                    mimeType: mime_type
                });
                console.log('Добавлен объект:', doc);
                ctx.reply("Чтение документа завершено: " + text.slice(0, 100) + "...");
            }
            if (mime_type == 'application/pdf') {
                // Обработка PDF-файлов
                // ctx.reply("Чтение документа PDF...");
                const text = await extractPdfText(localFilePath);
                const doc = await weaviateService.addObject({
                    content: text,
                    url: localFilePath,
                    title: fileName,
                    postedAt: new Date().toISOString()
                });
                console.log('Добавлен объект:', doc);
                ctx.reply("Чтение документа завершено" + text.slice(0, 100) + "...");
            }
        } catch (error) {
            console.error("Ошибка при обработке документа:", error.message);
            ctx.reply("Произошла ошибка при загрузке файла. Попробуйте еще раз.");
        }
    });
    bot.on("photo", async (ctx) => {
        const photos_arr = ctx.update.message.photo
        const photo = photos_arr[3];
        console.log(photo)
        const photoId = photo.file_id
        const photoName = photo.file_unique_id + ".jpg"
        let url = await ctx.telegram.getFileLink(photoId)
        const localFilePath = await downloadPhoto(ctx, url, photoName);

        // Отправляем подтверждение пользователю
        ctx.reply(`Файл "${photoName}" успешно загружен и сохранен: ${localFilePath}`);
    });

    bot.launch();
    console.log("Telegram-бот запущен");

    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

import express from 'express';
import { get } from "http";
const app = express();
app.use(express.json());

app.post('/from-n8n', (req, res) => {
    // console.log('Получено от n8n:', req.body);
    res.send('OK');
});

app.get('/documents', async (req, res) => {
    const myCollection = client.collections.get("Documents");
    console.log('n8n: запрос на получение документов');
    const documents = [];
    for await (const item of myCollection.iterator()) {
        // console.log('n8n: получен документ', item);
        documents.push({
            id: item.uuid,
            title: item.properties.title,
            url: item.properties.url,
            postedAt: item.properties.postedAt,
        });
    }
    res.json(documents);
});

app.get('/contents/', async (req, res) => {

    const query = req.query.query; // извлекаем параметр ?query=...
    console.log('n8n: запрос документа:', query);
    // Отправляем ответ
    const searchResults = await weaviateService.semanticSearch(query);
    console.log('Результаты поиска:', searchResults);

    res.json(searchResults);

});

app.listen(3000, () => {
    console.log('Сервер слушает на http://localhost:3000');
});

main().catch((error) => {
    console.error("Ошибка запуска:", error);
    process.exit(1);
});

// отправляем POST-запрос в n8n webhook
// npx n8n

async function sendToN8N(message, chatId) {
    try {
        let response = '';
        response = await fetch('http://127.0.0.1:5678/webhook-test/tg-text', {
            method: 'POST',
            timeout: 50000, // 10 секунд
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                chatId
            })
        });

        if (!response.ok) {
            response = await fetch('http://127.0.0.1:5678/webhook/tg-text', {
                method: 'POST',
                timeout: 50000, // 10 секунд
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message,
                    chatId
                })
            });
        }

        const data = await response.json();
        if (!response.ok) {
            return `Ошибка: ${'Сервис недоступен'}`;
        }
        // console.log('Ответ от n8n:', data[0].output);
        return data[0].output;
    } catch (error) {
        console.error('Ошибка:', response);
        return `Ошибка: ${error}`;
    }
}

