import weaviate from 'weaviate-client';
import { configure, vectorizer } from "weaviate-client";
import dotenv from "dotenv";
dotenv.config();

export class WeaviateService {
    constructor() {
        this.client = null;
        this.className = 'Document';
    }

    async init() {
        this.client = await weaviate.connectToCustom(
            {
                headers: {
                    'X-Goog-Studio-Api-Key': process.env.GOOGLE_API_KEY, // для AI Studio
                    // или 'X-Goog-Vertex-Api-Key': process.env.VERTEX_APIKEY // для Vertex AI
                },
                timeout: {
                    init: 30,   // Таймаут инициализации (сек)
                    query: 60,  // Таймаут запросов (сек)
                    insert: 300 // Таймаут вставки (сек)
                },
            }
        );

        if (this.client) {

            const exists = await this.client.collections.exists('Documents');
            if (exists) {
                console.log('✅ Класс уже существует');
                // this.client.collections.delete('Documents');
                // this.client.collections.delete('DocumentsMeta');
                return this.client;
            }
            console.log('Создание класса Documents...');
            await this.client.collections.create({
                name: 'Documents',
                description: 'Класс для хранения документов',
                properties: [
                    {
                        name: 'content',
                        dataType: configure.dataType.TEXT,
                    },
                    {
                        name: 'title',
                        dataType: configure.dataType.TEXT,
                    },
                    {
                        name: 'url',
                        dataType: configure.dataType.TEXT,
                    },
                    {
                        name: 'postedAt',
                        dataType: configure.dataType.DATE,
                    },
                    {
                        name: 'page', // можно добавить, если хочешь следить за порядком
                        dataType: configure.dataType.INT,
                    }
                ],
                vectorizers: [
                    weaviate.configure.vectorizer.text2VecTransformers({
                        name: 'default', // имя векторного пространства (можно опустить, если одно)
                        sourceProperties: ['content', 'title'], // какие поля векторизовать
                        // Можно явно указать inferenceUrl, но при вашей конфигурации это не обязательно
                        // inferenceUrl: 'http://t2v-transformers:8080',
                    }),
                ],
            });
            await this.client.collections.create({
                name: 'DocumentsMeta',
                description: 'Класс для хранения метаданных документов',
                properties: [
                    {
                        name: 'title',
                        dataType: configure.dataType.TEXT,
                    },
                    {
                        name: 'url',
                        dataType: configure.dataType.TEXT,
                    },
                    {
                        name: 'postedAt',
                        dataType: configure.dataType.DATE,
                    },
                ],
            });

            console.log('✅ Класс Document создан');
            return this.client;
        }
    }

    async addObject(data, className = 'Documents') {
        try {
            const docs = this.client.collections.get(className);
            await docs.data.insert(data);
            console.log('Объект успешно добавлен в коллекцию', className);
        } catch (error) {
            console.error('Ошибка при добавлении объекта в коллекцию:', error);
            throw error;
        }
    }

    async getAllObjects(className = 'DocumentsMeta') {
        const collection = this.client.collections.get(className);
        const documents = [];
        for await (const item of collection.iterator()) {
            documents.push({
                title: item.properties.title,
                url: item.properties.url,
                postedAt: item.properties.postedAt,
            });
        }

        return documents; // возвращаем массив как есть
    }

    async semanticSearch(text, limit = 5) {
        try {
            const Documents = this.client.collections.get('Documents');

            const result = await Documents.query.fetchObjects({
                query: text,
                limit: limit,
            });
            return result.objects.reduce((groups, chunk) => {
                const title = chunk.properties?.title || "unknown";
                if (!groups[title]) groups[title] = [];
                groups[title].push(chunk);
                return groups;
            }, {});
        } catch (error) {
            console.error('Error during semantic search:', error);
            throw error;
        }
    }

    async updateObject(id, updateData) {
        try {
            const response = await this.client.data
                .updater()
                .withClassName(this.className)
                .withId(id)
                .withProperties(updateData)
                .do();
            return response;
        } catch (error) {
            console.error('Error updating object:', error);
            throw error;
        }
    }

    async deleteObject(id) {
        try {
            await this.client.data
                .deleter()
                .withClassName(this.className)
                .withId(id)
                .do();
            return { success: true };
        } catch (error) {
            console.error('Error deleting object:', error);
            throw error;
        }
    }

    async getObjectById(id) {
        try {
            const result = await this.client.data
                .getterById()
                .withClassName(this.className)
                .withId(id)
                .do();
            return result;
        } catch (error) {
            console.error('Error getting object by id:', error);
            throw error;
        }
    }
}
