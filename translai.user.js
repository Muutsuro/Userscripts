// ==UserScript==
// @name         TranslAI
// @namespace    https://github.com/Muutsuro
// @version      1.1.0
// @description  -
// @author       Muutsuro
// @match        https://www.69shuba.com/book/*.htm
// @match        https://www.69shuba.com/txt/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=69shuba.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.setClipboard
// @downloadURL  https://github.com/Muutsuro/Userscripts/raw/refs/heads/main/translai.user.js
// @updateURL    https://github.com/Muutsuro/Userscripts/raw/refs/heads/main/translai.user.js
// ==/UserScript==

const COLOR = {
    RED: '#f8d7da',
    GREEN: '#d4edda',
    BLUE: '#afcde9',
    ORANGE: '#ffe5b4'
}

class Novel {
    constructor(titleElement, synopsisElement) {
        this.titleElement = titleElement;
        this.synopsisElement = synopsisElement;
    }

    static get id() {
        return location.href.split('/')[4];
    }

    async translate() {
        if (!this.title) {
            this.title = this.titleElement.innerText.trim();
        }

        if (!this.synopsis) {
            this.synopsis = this.synopsisElement.innerText.trim();
        }

        const titleInstruction = 'You are a professional Chinese-to-English translator. Translate this Chinese novel title. Output only the translated title.';
        const synopsisInstruction = 'You are a professional Chinese-to-English translator. Translate this Chinese novel synopsis. Output only the translated synopsis.';
        
        let title = this.title;
        let synopsis = this.synopsis;
        const names = NameManager.getGlobalNames();
        names.sort((a, b) => b.original.length - a.original.length);

        for (const name of names) {
            title = title.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
            synopsis = synopsis.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        this.translatedTitle = await Gemini.ask(titleInstruction, title);
        this.translatedSynopsis = await Gemini.ask(synopsisInstruction, synopsis);

        this.titleElement.innerText = this.translatedTitle;
        this.synopsisElement.innerText = this.translatedSynopsis;
    }
}

class Gemini {
    static async ask(instruction, input) {
        if (!this.apiKey) {
            this.apiKey = await GM.getValue('apiKey');

            if (!this.apiKey) {
                this.apiKey = prompt('Enter your Gemini API key').trim();

                if (!this.apiKey) {
                    return handleError(new Error('No Gemini API key'));
                }

                await GM.setValue('apiKey', this.apiKey);
            }
        }

        const payload = {
            systemInstruction: { parts: [{ text: instruction }] },
            contents: [{ parts: [{ text: input }] }]
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;

        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }

        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                if (response.status === 400) {
                    await GM.deleteValue('apiKey');
                    throw new Error('Gemini API key is invalid');
                }
            }

            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
        } catch (error) {
            handleError(error);
        }
    }
}

class Chapter {
    static instances = [];

    constructor(element) {
        this.element = element;
        Chapter.instances.push(this);
    }

    static getInstance() {
        return this.instances[0];
    }

    async translate() {
        if (!this.content) {
            document.querySelector('.tools')?.remove();
            this.element.querySelector('h1.hide720')?.remove();
            this.element.querySelector('.txtinfo')?.remove();
            this.content = this.element.innerText.trim();
        }

        let content = this.content;
        const names = NameManager.getNames();
        names.sort((a, b) => b.original.length - a.original.length);

        for (const name of names) {
            content = content.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        const instruction = 'You are a professional Chinese-to-English translator. Translate this Chinese novel chapter. Output only the translated chapter.';
        this.translatedContent = await Gemini.ask(instruction, content);
        await this.extractNames();
    }

    async extractNames() {
        const instruction = 'You are professional JSON extractor. Extract all proper nouns from the original and translated chapters. Create a JSON array using this format: [{"original":"proper noun from original chapter","translated":"proper noun from translated chapter"}]';

        const input = `Original chapter:
        ${this.content}
        
        Translated chapter:
        ${this.translatedContent}`;

        const names = await Gemini.ask(instruction, input);
        const parsedNames = JSON.parse(names.replace(/```json|```/g, ''));
        await NameManager.addNames(parsedNames);
        this.refreshDOM();
    }

    refreshDOM() {
        let content = this.translatedContent;
        const names = NameManager.getNames();
        names.sort((a, b) => b.translated.length - a.translated.length);

        for (const name of names) {
            content = content.replace(new RegExp(`(?!<span[^>]*?>)(${RegExp.escape(name.translated)})(?![^<]*?</span>)`, 'g'), () => {
                let color = COLOR.RED;

                const subState = NameManager.getSubState(name);

                if (subState) {
                    if (subState === 1) {
                        color = COLOR.GREEN;
                    } else if (subState === 2) {
                        color = COLOR.ORANGE;
                    }
                }

                if (name.checked) {
                    color = COLOR.BLUE;
                }

                if (NameManager.isGlobal(name)) {
                    color = COLOR.GREEN;
                }

                return `<span style="background-color: ${color}; user-select: all;" data-original="${name.original}">${name.translated}${subState ? '*' : ''}</span>`;
            });
        }

        this.element.innerHTML = content.replace(/\n/g, '<br>');
    }
}

class NameManager {
    static async init() {
        this.localNames = await GM.getValue(`names:${Novel.id}`) || [];
        this.globalNames = await GM.getValue('names') || [];
    }

    static async addNames(names) {
        for (const name of names) {
            if (!this.getName(name.original)) {
                this.localNames.push(name);
            }
        }

        await this.save();
    }

    static getName(originalName) {
        const names = this.getNames();
        return names.find(n => n.original === originalName);
    }

    static getNames() {
        return [...this.localNames, ...this.globalNames];
    }

    static async save() {
        await GM.setValue(`names:${Novel.id}`, this.localNames);
        await GM.setValue('names', this.globalNames);
    }

    static getSelectedName() {
        const selection = getSelection();
        let originalName;

        if (selection.rangeCount) {
            const range = selection.getRangeAt(0);
            const fragment = range.cloneContents();
            const span = fragment.querySelector('span[data-original]');

            if (span) {
                originalName = span.dataset.original;
            }
        }

        return this.getName(originalName);
    }

    static async addGlobal() {
        const name = this.getSelectedName();

        if (!name) {
            return;
        }

        const nameIndex = this.localNames.findIndex(n => n.original === name.original);

        if (nameIndex !== -1) {
            this.localNames.splice(nameIndex, 1);
            this.globalNames.push(name);
            await this.save();
            Chapter.getInstance().refreshDOM();
        }
    }

    static isGlobal(name) {
        return this.globalNames.find(n => n.original === name.original) ? true : false;
    }

    static async editName() {
        const name = this.getSelectedName();

        if (!name) {
            return;
        }

        const newName = prompt('Enter new name').trim();

        if (!newName) {
            return;
        }

        const oldName = name.translated;
        name.translated = newName;
        await this.save();
        const chapter = Chapter.getInstance();
        chapter.translatedContent = chapter.translatedContent.replace(new RegExp(RegExp.escape(oldName), 'g'), newName);
        chapter.refreshDOM();
    }

    static async checkName() {
        const name = this.getSelectedName();

        if (!name) {
            return;
        }

        name.checked = true;
        await this.save();
        Chapter.getInstance().refreshDOM();
    }

    static async copyName() {
        const name = this.getSelectedName();
        await GM.setClipboard(name?.original, 'text');
    }

    static async deleteName() {
        const name = this.getSelectedName();

        if (!name) {
            return;
        }

        const localIndex = this.localNames.findIndex(n => n.original === name.original);
        const globalIndex = this.globalNames.findIndex(n => n.original === name.original);
        if (localIndex !== -1) this.localNames.splice(localIndex, 1);
        if (globalIndex !== -1) this.globalNames.splice(globalIndex, 1);
        await this.save();
        Chapter.getInstance().refreshDOM();
    }

    static getGlobalNames() {
        return [...this.globalNames];
    }

    static getSubState(name) {
        if (this.isGlobal(name) || name.checked) return;
        const globalNames = this.getGlobalNames();
        let partial = false;

        for (const globalName of globalNames) {
            if (globalName.original.includes(name.original) && globalName.translated.includes(name.translated)) {
                return 1;
            }

            if (globalName.original.includes(name.original)) {
                partial = true;
            }
        }

        return partial ? 2 : 0;
    }
}

class Button {
    static offset = 0;

    constructor(text, callback) {
        const element = document.createElement('button');
        element.addEventListener('click', callback);
        element.textContent = text;

        Object.assign(element.style, {
            position: 'fixed',
            bottom: `${5 + Button.offset}px`,
            right: '5px',
            'z-index': '1000',
            padding: '8px',
            'font-size': '14px',
            'background-color': '#e0e8f0'
        });

        Button.offset += 40;
        document.body.appendChild(element);
    }
}

function handleError(error) {
    console.log(error);

    const errorDetails = {
        name: error.name,
        message: error.message,
        stack: error.stack
    }

    document.body.innerHTML = `<pre>${JSON.stringify(errorDetails, null, 4)}</pre>`;
}

await NameManager.init();
const url = location.href;

if (url.includes('book')) {
    const titleElement = document.querySelector('.booknav2 > h1 > a');
    const synopsisElement = document.querySelector('.navtxt > p:nth-child(1)');
    const novel = new Novel(titleElement, synopsisElement);
    await novel.translate();
} else if (url.includes('txt')) {
    const chapterElement = document.querySelector('.txtnav');
    const chapter = new Chapter(chapterElement);
    await chapter.translate();

    new Button('➕', NameManager.addGlobal.bind(NameManager));
    new Button('✅', NameManager.checkName.bind(NameManager));
    new Button('✏️', NameManager.editName.bind(NameManager));
    new Button('❌', NameManager.deleteName.bind(NameManager));
    new Button('📋', NameManager.copyName.bind(NameManager));
}
