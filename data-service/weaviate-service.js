import weaviate from 'weaviate-client';
import { configure, vectorizer } from "weaviate-client";

export class WeaviateService {
    constructor() {
        this.client = null;
        this.className = 'Document';
    }

    async init() {
        this.client = await weaviate.connectToCustom();

        if (this.client) {

            const myCollection = this.client.collections.get('Documents');
            if (myCollection) {
                console.log('✅ Класс уже существует:', myCollection.name);
                // this.client.collections.delete('Documents');
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
                // generative: weaviate.configure.generative.openAI(),
            });

            console.log('✅ Класс Document создан');
            return this.client;
        }
    }

    async addObject(data) {
        try {
            const questions = this.client.collections.get("Documents");
            await questions.data.insert(data);
            console.log('Объект успешно добавлен:');
        } catch (error) {
            console.error('Error adding object:', error);
            throw error;
        }
    }

    async semanticSearch(text, limit = 5) {
        try {
            const Documents = this.client.collections.get('Documents');

            const result = await Documents.query.fetchObjects({
                query: text,
                limit: limit,
            });
            const response = JSON.stringify(result);
            // console.log('Semantic search results:', response);
            return response;
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
