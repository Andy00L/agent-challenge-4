declare const project: {
    agents: {
        character: {
            name: string;
            username: string;
            plugins: string[];
            system: string;
            bio: string[];
            messageExamples: {
                name: string;
                content: {
                    text: string;
                };
            }[][];
            postExamples: any[];
            topics: string[];
            adjectives: string[];
            knowledge: any[];
            style: {
                all: string[];
                chat: string[];
                post: any[];
            };
            settings: {
                model: string;
            };
        };
        plugins: any[];
        init: () => Promise<void>;
    }[];
};
export default project;
