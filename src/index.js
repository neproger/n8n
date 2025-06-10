import https from "https";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import pdfParse from "pdf-parse";
import { WeaviateService } from './data-service/weaviate-service.js';
import { generateUuid5 } from 'weaviate-client';
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

async function semanticSearch(query) {
    console.log('search tool: ', query);

    // Отправляем ответ
    const response = await weaviateService.semanticSearch(query);
    // console.log('Результаты поиска:', JSON.stringify(response));
    return JSON.stringify(response);
}

async function getDocuments() {
    const documentsJson = await weaviateService.getAllObjects();
    console.log("Запрос на получение документов" + JSON.stringify(documentsJson));
    return JSON.stringify(documentsJson); // возвращаем массив как есть
}

async function addNoteToDB(note) {
    console.log(`Заметка:`, note.title, note.text);
    const date = new Date().toISOString();

    await weaviateService.addObject({
        url: "Заметка",
        title: note.title,
        postedAt: date,
    }, "DocumentsMeta").then(() => {
        console.log(`DocumentsMeta добавлен объект ${note.title}: ${date}`);
    }).catch((error) => {
        console.error(`Ошибка при добавлении метаданных заметки: ${error.message}`);
        return `Ошибка при добавлении метаданных заметки: ${error.message}`;
    });

    await weaviateService.addObject({
        url: "Заметка",
        title: note.title,
        postedAt: date,
        content: note.text,
    }, "Documents").then(() => {
        console.log(`Documents добавлен объект ${note.title}: ${date}`);
    }).catch((error) => {
        console.error(`Ошибка при добавлении заметки: ${error.message}`);
        return `Ошибка при добавлении заметки: ${error.message}`;
    });

    return `Заметка "${note.title}" успешно добавлена в базу данных.`;
}

// LLM ////////////////////////////////

const model = new ChatGoogleGenerativeAI(
    {
        model: "gemini-1.5-flash", //gemini-2.5-flash-preview-05-20 gemini-1.5-flash
        openAIApiKey: process.env.GOOGLE_API_KEY,
    }
);

const addNoteToDBTool = tool(addNoteToDB, {
    name: "add_note_to_db",
    description: `Добавить заметку в базу данных Weaviate. Придумай заголовок заметки. Сформируй текст заметки на основе запроса пользователя.`,
    schema: z.object({
        title: z.string().describe("Заголовок заметки"),
        text: z.string().describe("Текст заметки"),
    }),
});

const getDocumentsTool = tool(getDocuments, {
    name: "get_documents",
    description: `Получить все документы из коллекции Weaviate.
Оформи ответ в таком стиле:
1.  💾 title
    📆 postedAt
    📎 url

2.  💾 title
    📆 postedAt
    📎 url
`,
    schema: z.object({}),
});

const semanticSearchTool = tool(semanticSearch, {
    name: "search",
    description: `Поиск документов в базе данных Weaviate по запросу пользователя.`,
    schema: z.object({
        query: z.string().describe("Запрос для поиска документов"),
    }),
});

// Создание агента
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const checkpointer = new MemorySaver();

const agent = createReactAgent({
    llm: model,
    tools: [getDocumentsTool, addNoteToDBTool, semanticSearchTool],
    checkpointer,
    prompt: "Ты умный ассистент, Ваня. Ты можешь использовать инструменты. Для получения документов getDocumentsTool. Для добавления заметки в базу данных addNoteToDBTool. Для поиска документов в базе данных Weaviate по запросу пользователя semanticSearchTool.",

});

// LLM ////////////////////////////////////

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPdfPages(filePath) {
    const pdfData = await fs.readFile(filePath);
    const pdfDataArray = new Uint8Array(pdfData);
    const loadingTask = pdfjsLib.getDocument({
        data: pdfDataArray,
        standardFontDataUrl: path.join(
            import.meta.dirname,
            "node_modules/pdfjs-dist/standard_fonts/"
        ),
    });
    const pdf = await loadingTask.promise;

    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const opList = await page.getOperatorList();
        if (opList.fnArray.length > 0) {
            console.log(`Page ${i} opList:`, opList.fnArray);
        }
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        pages.push(pageText);
    }

    return pages; // массив строк, по одной на страницу
}

async function addPDFtoDB(fileName, localFilePath, chatId, bot) {
    const postedAt = new Date().toISOString();
    // Генерируем UUID на основе ключевых свойств (например, documentId)
    const object_uuid = generateUuid5(JSON.stringify({ documentId: localFilePath }));

    const docMetas = client.collections.get('DocumentsMeta');

    await weaviateService.addObject({
        url: localFilePath,
        title: fileName,
        postedAt,
    }, "DocumentsMeta");
    console.log(`Метаданные документа "${fileName}" успешно добавлены в базу данных.`);

    const pdfPages = await extractPdfPages(localFilePath);
    for (let i = 0; i < pdfPages.length; i++) {

        await weaviateService.addObject({
            content: `Page ${i + 1}: ` + pdfPages[i],
            url: localFilePath,
            title: fileName,
            postedAt,
            page: i + 1, // добавляем номер страницы
        }).then(() => {
            console.log(`Page ${i + 1}: ${pdfPages[i].slice(0, 30)}...`);
        });

    }

    const message = `Документ "${fileName}" успешно добавлен в базу данных.`;
    bot.telegram.sendMessage(chatId, message);
}

async function main() {
    bot.on("text", async (ctx) => {
        try {
            const message = ctx.message.text;
            console.log("Я: " + message);
            const chatId = ctx.chat.id;
            const config = { configurable: { thread_id: chatId } };
            const result = await agent.invoke({
                messages: [{ role: "user", content: message }]
            }, config);
            // console.log("response LLM:", result);

            const lastMessage = result.messages.at(-1); // или result.messages[result.messages.length - 1]

            console.log("ЛЛМ: " + lastMessage.content);
            ctx.reply(lastMessage.content);
        } catch (error) {
            console.error("Ошибка при обработке сообщения:", error);
            ctx.reply("Произошла ошибка. Попробуйте еще раз.");
        }
    });
    // Обработчик документов
    bot.on("document", async (ctx) => {
        try {
            const chatId = ctx.chat.id;
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
                ctx.reply("Чтение документа завершено: " + text.slice(0, 100) + "...");
                addToDB(text, fileName, localFilePath, chatId, bot);
            }
            if (mime_type == 'application/pdf') {
                // Обработка PDF-файлов

                addPDFtoDB(fileName, localFilePath, chatId, bot);
                ctx.reply("Обработка документа: " + fileName);
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

