import { pipeline } from '@xenova/transformers';

let extractor;

export const generateFreeEmbeddings = async (text) => {
    try {
        // Load the model only if it hasn't been loaded yet
        if (!extractor) {
            extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        }

        // Generate the embedding
        const output = await extractor(text, { pooling: 'mean', normalize: true });

        // Convert the data to a standard Javascript Array
        return Array.from(output.data);
    } catch (error) {
        console.error("Embedding Generation Error:", error);
        return null;
    }
};