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

            const myCollection = this.client.collections.get('Document');
            if (myCollection) {
                console.log('✅ Класс Document уже существует');
                return;
            }
            console.log('Создание класса Document...');
            await this.client.collections.create({
                name: 'Document',
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
                    }
                ],
                vectorizers: vectorizer.text2vecContextionary,

            });

            console.log('✅ Класс Document создан');
            
        }
    }

    async addObject(data) {
        try {
            const response = await this.client.data
                .creator()
                .withClassName(this.className)
                .withProperties(data)
                .do();
            return response;
        } catch (error) {
            console.error('Error adding object:', error);
            throw error;
        }
    }

    async semanticSearch(text, limit = 5) {
        try {
            const myCollection = this.client.collections.get('Document');

            const result = await myCollection.query.fetchObjects({
                query: text,
                limit: limit,
                vectorizer: vectorizer.text2vec-transformers,
            });
            const response = JSON.stringify(result, null, limit);
            console.log('Semantic search results:', response);
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
