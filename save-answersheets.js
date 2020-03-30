#!/usr/bin/env node

const archiver = require('archiver');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const puppeteer = require('puppeteer');
const urlUtils = require('url');
const util = require('util');

(async() => {
    await readAndProcessFile('example-instructions.txt');
})();


async function readAndProcessFile(instructionFile) {
    const script = await util.promisify(fs.readFile)(instructionFile);
    const actions = parseScript(script.toString('utf8'));

    if (actions.length === 0) {
        throw new Error('Instruction script is empty!');
    }

    const filepath = path.resolve('output', actions.shift()[1]);
    await verifyPathDoesNotExist(filepath);
    await createPath(filepath);
    console.log('Using working directory %s.', filepath);

    let action;
    while ((action = actions.shift())) {
        const filename =  path.resolve(filepath, action[3]);

        switch (action[0]) {
            case 'save-file':
                await saveUrlAsFile(action[1], filename);
                break;

            case 'save-pdf':
                await saveUrlAsPdf(action[1], filename);
                break;

            default:
                throw new Error('Unrecognised action. Should have been caughte before now.');
        }
        console.log('Saved ' + filename);
    }

    await zipDirectory(filepath, filepath + '.zip');
    console.log('Created ' + filepath + '.zip');
}

function parseScript(script) {
    const lines = script.split(/[ \t]*[\r\n]\s*/);
    const actions = lines
        .filter(line => line !== '' && !line.startsWith('#'))
        .map(line => line.split(/[ \t]+/));
    actions.forEach(verifyAction);
    return actions;
}

function verifyAction(action, row) {
    if (row === 0) {
        if (action[0] !== 'zip-name') {
            throw new Error('First link of the instructions script must give the zip-name. ' +
                action[0] + ' found');
        }
        if (action.length !== 2) {
            throw new Error('zip-name line should only say zip-name <filename>. ' +
                'The filename cannot contain spaces.');
        }
        if (!(/^[-_.a-zA-Z0-9]+$/.test(action[1]))) {
            throw new Error('The zip name may only contains characters -, _, ., a-z, A-Z and 0-9.');
        }

    } else {
        if (action[0] !== 'save-file' && action[0] !== 'save-pdf') {
            throw new Error('After the first line, the only recongised actions are save-file and save-pdf. ' +
                action[0] + ' found.');
        }
        if (action.length !== 4 || action[2] !== 'as') {
            throw new Error('save-file and save-pdf actions must be of the form ' +
                'save-file <URL> as <file/path/in/zip>. The URL and file path cannot contain spaces.' +
                ' Found ' + action.join(' '));
        }
        if (!/^[-_.\/a-zA-Z0-9]+$/.test(action[3])) {
            throw new Error('The file name to save as may only contains characters -, _, ., /, a-z, A-Z and 0-9.' +
                ' Found ' + action[3]);
        }
    }
}

async function saveUrlAsPdf(url, filename) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle2'});
    await page.pdf({path: filename, format: 'A4'});
    await browser.close();
}

async function saveUrlAsFile(url, filename) {
    const contents = await fetchUrl(url);
    return await writeFile(contents, filename);
}

async function fetchUrl(urlString) {
    return new Promise((resolve, reject) => {
        const url = urlUtils.parse(urlString);
        const req = (url.protocol === 'https:' ? https : http).get(urlString, res => {
            res.on('data', data => {
                resolve(data);
            })
        });

        req.on('error', error => {
            reject(error);
        });
    });
}

async function writeFile(content, filename) {
    await createPath(path.dirname(filename));
    return new Promise((resolve, reject) => {
        fs.writeFile(filename, content, err => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
}

async function verifyPathDoesNotExist(filepath) {
    return new Promise((resolve, reject) => {
        fs.access(filepath, (err) => {
            if (err) {
                // File does not exist. This is what we want.
                resolve();
            } else {
                reject('Target directory already exists. Please move or delete it and then try again.');
            }
        });
    });
}

async function createPath(filepath) {
    return new Promise((resolve, reject) => {
        fs.mkdir(filepath, {recursive: true}, (err) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
}

async function zipDirectory(directory, zipFile) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 }});
        const stream = fs.createWriteStream(zipFile);
        archive
            .directory(directory, path.basename(directory))
            .on('error', err => reject(err))
            .pipe(stream);

        stream.on('close', () => resolve());
        archive.finalize();
    });
}
