const axios = require('axios');
const fs = require('fs').promises;

const CONFIG = {
    amount: 1000,
    webhookUrl: '', // PUT UR OWN WEBHOOK HERE SO IT LINKS TO DISCORD MEOWWWW
    concurrency: 10,
    workingDataFile: 'working_sacs.json',
    unusedDataFile: 'unused_sacs.json',
    wordListFile: 'words.txt',
    requestDelay: 100,
    similarWordsLimit: 10
};

class SACChecker {
    constructor() {
        this.workingSacs = new Set();
        this.unusedSacs = new Set();
        this.checkedSacs = new Set();
        this.wordList = [];
    }

    fuzzyMatch(a, b) {
        const m = Array(b.length + 1).fill().map(() => Array(a.length + 1).fill(0));
        for (let i = 0; i <= a.length; i++) m[0][i] = i;
        for (let j = 0; j <= b.length; j++) m[j][0] = j;
        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const ind = a[i - 1] === b[j - 1] ? 0 : 1;
                m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + ind);
            }
        }
        return m[b.length][a.length];
    }

    simWords(inputWord) {
        const lowInput = inputWord.toLowerCase();
        const sims = this.wordList
            .filter(word => {
                const lowWord = word.toLowerCase();
                return (
                    lowWord.startsWith(lowInput.slice(0, 3)) ||
                    this.fuzzyMatch(lowInput, lowWord) <= 2
                ) &&
                word.length >= 3 &&
                word.length <= 10 &&
                word.trim() &&
                !this.checkedSacs.has(word);
            })
            .slice(0, CONFIG.similarWordsLimit);
        if (
            inputWord.length >= 3 &&
            inputWord.length <= 10 &&
            inputWord.trim() &&
            !this.checkedSacs.has(inputWord)
        ) {
            sims.unshift(inputWord);
        }
        return [...new Set(sims)];
    }

    async sendHook(msg, embeds = []) {
        try {
            await axios.post(CONFIG.webhookUrl, { content: msg, embeds });
        } catch (error) {
            console.error('Failed to send Discord webhook notification:', error.message);
        }
    }

    async downloadWordList() {
        try {
            const response = await axios.get('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt');
            this.wordList = response.data.split('\n').map(word => word.replace(/\r/g, '')).filter(word => 
                word.length >= 3 && word.length <= 10 && word.trim()
            );
            return Promise.resolve();
        } catch (error) {
            console.error('Failed to download word list:', error.message);
            throw error;
        }
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
            const response = await axios.get(`https://fortnite-api.com/v2/creatorcode?name=${encodeURIComponent(sac)}`, { timeout: 5000 });
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

    async run(inputWord = null) {
        await this.loadWordList();
        await this.loadData();
        let totalSacs;
        let message;
        if (inputWord) {
            totalSacs = this.simWords(inputWord);
            message = `Checking SAC "${inputWord}" and ${totalSacs.length - 1} similar words`;
        } else {
            totalSacs = this.generateUniqueSacs(CONFIG.amount);
            message = `Starting SAC Checker for ${CONFIG.amount} random SACs`;
        }
        await this.sendHook(null, [{
            title: 'SAC Check Started',
            description: message,
            color: 0x00ff00,
            timestamp: new Date().toISOString()
        }]);
        for (let i = 0; i < totalSacs.length; i += CONFIG.concurrency) {
            const batch = totalSacs.slice(i, i + CONFIG.concurrency);
            await Promise.all(batch.map(sac => this.checkSac(sac)));
            await this.saveData();
            if (i + CONFIG.concurrency < totalSacs.length) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
            }
        }
        await this.saveData();
        await this.sendHook('SAC Checking Complete!', [{
            title: 'Final Results',
            description: `Total SACs Checked: ${totalSacs.length}\nWorking SACs Found: ${this.workingSacs.size}\nUnused SACs: ${this.unusedSacs.size}`,
            color: 0xff0000,
            timestamp: new Date().toISOString()
        }]);
    }
}

const inputWord = process.argv[2];
new SACChecker().run(inputWord).catch(console.error);
