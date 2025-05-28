import https from "https";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import pdfParse from "pdf-parse";

dotenv.config();
// telegram-bot-api
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN

const bot = new Telegraf(telegramBotToken);

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

        console.log(`Файл сохранен: ${localFilePath}`);
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

async function main() {
    bot.on("text", async (ctx) => {
        try {
            const userMessage = ctx.message.text;
            console.log("Получено сообщение:", userMessage, ctx.chat.id);
            // Отправляем ответ
            const response = await sendToN8N(userMessage, ctx.chat.id);
            ctx.reply(response);
        } catch (error) {
            console.error("Ошибка при обработке сообщения:", error.message);
            ctx.reply("Произошла ошибка. Попробуйте еще раз.");
        }
    });
    // Обработчик документов
    bot.on("document", async (ctx) => {
        try {
            const fileId = ctx.message.document.file_id;
            const fileName = ctx.message.document.file_name || `document_${ctx.message.message_id}`;
            const mime_type = ctx.message.document.mime_type;
            console.log(`Получен документ: `, ctx.message.document);

            // Загружаем файл
            const localFilePath = await downloadFile(ctx, fileId, fileName);

            // Отправляем подтверждение пользователю
            ctx.reply(`Файл "${fileName}" успешно загружен и сохранен: ${localFilePath}`);

            if(mime_type == 'text/plain'){
                // Обработка текстовых файлов
                const text = await fs.readFile(localFilePath, 'utf-8');
                console.log("Обработка текстовых файлов", text)
            }
            if(mime_type == 'application/pdf'){
                // Обработка PDF-файлов
                // ctx.reply("Чтение документа PDF...");
                const text = await extractPdfText(localFilePath);
                ctx.reply("Чтение документа завершено" + text.slice(0, 100) + "...");
                sendToN8N(`Загружен документ PDF: ${fileName} \n\n` + text, ctx.chat.id)
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
const app = express();
app.use(express.json());

app.post('/from-n8n', (req, res) => {
  console.log('Получено от n8n:', req.body);
  res.send('OK');
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
    const response = await fetch('http://127.0.0.1:5678/webhook-test/tg-text', {
        method: 'POST',
        body: JSON.stringify({
          message,
          chatId
        })
    });

    const data = await response.json();
    if (!response.ok) {
      return `Ошибка: ${'Сервис недоступен'}`;
    }
    console.log('Ответ от n8n:', data[0].output);
    return data[0].output;
  } catch (error) {
    console.error('Ошибка:', error);
    return `Ошибка: ${'Сервис недоступен'}`;
    
  }
}

