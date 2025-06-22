const axios = require('axios');
const fs = require('fs').promises;
const https = require('https');

const CONFIG = {
    amount: 1000,
    concurrency: 10,
    workingDataFile: 'working_sacs.json',
    unusedDataFile: 'unused_sacs.json',
    wordListFile: 'words.txt',
    requestDelay: 100
};

class SACChecker {
    constructor() {
        this.workingSacs = new Set();
        this.unusedSacs = new Set();
        this.checkedSacs = new Set();
        this.wordList = [];
    }

    async downloadWordList() {
        return new Promise((resolve) => {
            https.get('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt', (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => {
                    this.wordList = data.split('\n').map(word => word.replace(/\r/g, '')).filter(word => 
                        word.length >= 3 && word.length <= 10 && word.trim()
                    );
                    resolve();
                });
            });
        });
    }

    async loadWordList() {
        try {
            const data = await fs.readFile(CONFIG.wordListFile, 'utf8');
            this.wordList = data.split('\n').map(word => word.replace(/\r/g, '')).filter(word => 
                word.length >= 3 && word.length <= 10 && word.trim()
            );
        } catch {
            await this.downloadWordList();
            await fs.writeFile(CONFIG.wordListFile, this.wordList.join('\n'));
        }
    }

    async loadData() {
        try {
            this.workingSacs = new Set(JSON.parse(await fs.readFile(CONFIG.workingDataFile, 'utf8')).workingSacs || []);
        } catch {}
        try {
            this.unusedSacs = new Set(JSON.parse(await fs.readFile(CONFIG.unusedDataFile, 'utf8')).unusedSacs || []);
        } catch {}
        this.checkedSacs = new Set([...this.workingSacs, ...this.unusedSacs]);
    }

    async saveData() {
        await fs.writeFile(CONFIG.workingDataFile, JSON.stringify({
            workingSacs: Array.from(this.workingSacs),
            count: this.workingSacs.size
        }, null, 2));
        await fs.writeFile(CONFIG.unusedDataFile, JSON.stringify({
            unusedSacs: Array.from(this.unusedSacs),
            count: this.unusedSacs.size
        }, null, 2));
    }

    async checkSac(sac) {
        if (this.checkedSacs.has(sac)) return;
        this.checkedSacs.add(sac);
        try {
            const response = await axios.get(`https://fortnite-api.com/v2/creatorcode?name=${sac}`, { timeout: 5000 });
            if (response.data?.data) {
                this.workingSacs.add(sac);
            } else {
                this.unusedSacs.add(sac);
            }
        } catch {
            this.unusedSacs.add(sac);
        }
    }

    generateUniqueSacs(count) {
        const sacs = new Set();
        while (sacs.size < count) {
            const sac = this.wordList[Math.floor(Math.random() * this.wordList.length)];
            if (!this.checkedSacs.has(sac)) {
                sacs.add(sac);
            }
        }
        return Array.from(sacs);
    }

    async run() {
        await this.loadWordList();
        await this.loadData();
        const totalSacs = this.generateUniqueSacs(CONFIG.amount);
        let processed = 0;
        for (let i = 0; i < totalSacs.length; i += CONFIG.concurrency) {
            const batch = totalSacs.slice(i, i + CONFIG.concurrency);
            await Promise.all(batch.map(sac => this.checkSac(sac)));
            processed += batch.length;
            if (processed % (CONFIG.concurrency * 5) === 0) {
                await this.saveData();
            }
            if (i + CONFIG.concurrency < totalSacs.length) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
            }
        }
        await this.saveData();
    }
}

new SACChecker().run().catch(console.error);