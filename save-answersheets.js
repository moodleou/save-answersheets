#!/usr/bin/env node

const archiver = require('archiver');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const puppeteer = require('puppeteer');
const urlUtils = require('url');
const util = require('util');

// This is the main part of the script.
const options = require('minimist')(process.argv.slice(2), {
    alias: {
        h: 'help',
    },
    boolean: ['help'],
    string: ['download-only'],
    default: {
        'help': false,
        'download-only': ''
    }
});

if (options.help || options._.length !== 1) {
    showHelpAndExit();
}
(async() => {
    try {
        await readAndProcessInstructionFile(options._[0]);
        process.exit(0);
    } catch (error) {
        displayErrorAndExit(error)
    }
})();

// End of main script. Functions follow.

function showHelpAndExit() {
    console.log('Usage: ./save-answersheets [options] <instructionfile>');
    console.log();
    console.log('Options: -h, --help               Show this help and exit.');
    console.log('Options: -download-only=X1234567  If specified, will only download the data for this user.');
    console.log('                                  In this case, will always download, even if the file already exists.');
    process.exit(0);
}

function displayErrorAndExit(error) {
    console.error(error);
    process.exit(1);
}

async function checkPath(basePath, relativePath) {
    const filename = path.resolve(basePath, relativePath);

    if (options['download-only'] !== '') {
        if (!relativePath.startsWith(options['download-only'] + '/')) {
            console.log('Skipping       %s - not the user of interest', path.relative('', filename));
            return '';
        }
    } else {
        if (await pathExists(filename)) {
            console.log('Skipping       %s - already downloaded', path.relative('', filename));
            return '';
        }
    }
    return filename;
}

async function readAndProcessInstructionFile(instructionFile) {
    const script = await util.promisify(fs.readFile)(instructionFile);
    const actions = parseScript(script.toString('utf8'));

    if (actions.length === 0) {
        throw new Error('Instruction script is empty!');
    }

    const filepath = path.resolve('output', actions.shift()[1]);
    await createPath(path.resolve('output'));
    await createPath(filepath);

    const browser = await puppeteer.launch();

    let action;
    let cookies = '';
    while ((action = actions.shift())) {
        switch (action[0]) {
            case 'save-file':
                const filename = await checkPath(filepath, action[3]);
                if (filename !== '') {
                    await saveUrlAsFile(action[1], filename, cookies);
                    console.log('Saved          %s', path.relative('', filename));
                }
                break;

            case 'save-pdf':
                const pdfFilename = await checkPath(filepath, action[3]);
                if (pdfFilename !== '') {
                    await saveUrlAsPdf(browser, action[1], pdfFilename, cookies);
                    console.log('Saved          %s', path.relative('', pdfFilename));
                }
                break;

            case 'cookies':
                cookies = (Buffer.from(action[1], 'base64')).toString('ascii');
                break;

            default:
                throw new Error('Unrecognised action. Should have been caught before now.');
        }
    }

    await browser.close();
    await zipDirectory(filepath, filepath + '.zip');
    console.log('');
    console.log('Created %s', path.relative('', filepath + '.zip'));
    console.log('The end.');
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

    } else if (action[0] === 'cookies') {
        if (action.length !== 2) {
            throw new Error('cookies line should only say cookies <base64blob>.');
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
        // Should be the same as Moodle's PARAM_FILE.
        // The bit at the start is \p{Control}, but Node does not seem to support that yet.
        // And we additionally disallow * and ? here.
        if (/[\0-\x1F\x7F-\x9F*?&<>"`|':\\]/u.test(action[3])) {
            throw new Error("The filename '" + action[3] + "' contains disallowed characters.");
        }
    }
}

async function saveUrlAsPdf(browser, url, filename, cookies) {
    await createPath(path.dirname(filename));
    const page = await browser.newPage();
    if (cookies) {
        const cookieObjects = parseCookies(cookies, url);
        for (let i = 0; i < cookieObjects.length; i++) {
            await page.setCookie(cookieObjects[i]);
        }
    }
    page.setDefaultNavigationTimeout(5 * 60 * 1000); // 5 minutes
    await page.goto(url, {waitUntil: 'networkidle2'});
    await page.pdf({path: filename, format: 'A4'});
    await page.close();
}

function parseCookies(cookiesHeader, urlString) {
    const url = urlUtils.parse(urlString);

    const cookies = [];
    cookiesHeader.split(/ *; */).forEach((cookie) => {
        const bits = cookie.split('=', 2);
        cookies.push({
            'name': bits[0],
            'value': bits[1],
            'domain': url.hostname
        })
    });

    return cookies;
}

async function saveUrlAsFile(urlString, filename, cookies) {
    await createPath(path.dirname(filename));
    const writeStream = fs.createWriteStream(filename);

    return new Promise((resolve, reject) => {
        const url = urlUtils.parse(urlString);
        const options = {
            'host': url.hostname,
            'path': url.pathname + (url.search ? url.search : ''),
        };
        if (cookies) {
            options['headers'] = {
                'Cookie': cookies
            };
        }

        const req = (url.protocol === 'https:' ? https : http).get(options, response => {
            response.pipe(writeStream);
            writeStream.on('finish', async () => {
                await writeStream.close();
                resolve();
            })
        });

        req.on('error', reject);
    });
}

async function pathExists(filepath) {
    return new Promise((resolve) => {
        fs.access(filepath, (err) => {
            if (err) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

async function createPath(filepath) {
    if (!(await pathExists(filepath))) {
        console.log('Created folder %s', path.relative('', filepath));
        return new Promise((resolve, reject) => {
            fs.mkdir(filepath, (err) => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
    }
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
