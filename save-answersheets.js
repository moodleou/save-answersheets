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
        v: 'version'
    },
    boolean: ['help', 'version', 'skip-pdfs'],
    string: ['download-only', 'redownload-if-smaller'],
    default: {
        'help': false,
        'version': false,
        'download-only': '',
        'redownload-if-smaller': '',
        'skip-pdfs': false
    }
});

if (options.version) {
    showVersionAndExit();
}
if (options.help || options._.length !== 1) {
    showHelpAndExit();
}

(async() => {
    try {
        if (options['redownload-if-smaller'] !== '') {
            options['redownload-if-smaller'] = parseBytes(options['redownload-if-smaller']);
        }
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
    console.log('Options: -h, --help                  Show this help and exit.');
    console.log('Options: -v, --version               Print version information and exit.');
    console.log('Options: --download-only=X1234567    If specified, will only download the data');
    console.log('                                     for this user. In this case, will always');
    console.log('                                     download, even if the file already exists.');
    console.log('Options: --redownload-if-smaller=5KB If the responses.pdf file is less than');
    console.log('                                     this size, re-download the whole attempt.');
    console.log('                                     The size can be in B, KB, MB or GB.');
    console.log('Options: --skip-pdfs                 Don\'t download responses.pdf files,');
    console.log('                                     just do the attachments.');
    process.exit(0);
}

function showVersionAndExit() {
    console.log('This is save-answersheets version 2021-09-16.');
    process.exit(0);
}

function displayErrorAndExit(error) {
    console.error(error);
    process.exit(1);
}

async function checkPath(basePath, relativePath) {
    const filename = path.resolve(basePath, relativePath);

    if (options['download-only'] !== '') {
        if (!relativePath.startsWith(options['download-only'] + '/responses.pdf')) {
            console.log('Skipping       %s - not the user of interest', path.relative('', filename));
            return '';
        }
    } else {
        if (await pathExists(filename)) {
            if (options['redownload-if-smaller'] !== '' && relativePath.endsWith('/responses.pdf')) {
                const size = getFileSize(filename);
                if (size < options['redownload-if-smaller']) {
                    const dir = path.dirname(filename);
                    console.log('Re-fetching    %s - already downloaded but responses.pdf only %s',
                            path.relative('', dir), formatBytes(size));
                    deleteFolder(dir);
                    return filename;
                }
            }
            console.log('Skipping       %s [%s] - already downloaded', path.relative('', filename),
                formatBytes(getFileSize(filename)));
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

    const startTime = new Date();
    console.log('Run started at %s', startTime.toLocaleString());

    let action;
    let cookies = '';
    while ((action = actions.shift())) {
        switch (action[0]) {
            case 'save-file':
                const filename = await checkPath(filepath, action[3]);
                if (filename !== '') {
                    await saveUrlAsFile(action[1], filename, cookies);
                    console.log('Saved          %s [%s]', path.relative('', filename),
                        formatBytes(getFileSize(filename)));
                }
                break;

            case 'save-pdf':
                const pdfFilename = await checkPath(filepath, action[3]);
                if (pdfFilename !== '') {
                    await createPath(path.dirname(pdfFilename));
                    if (!options['skip-pdfs']) {
                        await saveUrlAsPdf(browser, action[1], pdfFilename, cookies);
                        console.log('Saved          %s [%s]', path.relative('', pdfFilename),
                            formatBytes(getFileSize(pdfFilename)));
                    } else {
                        console.log('Skipping       %s - due to skip-pdfs option', path.relative('', pdfFilename));
                    }
                }
                break;

            case 'save-text':
                const textFilename = await checkPath(filepath, action[3]);
                if (textFilename !== '') {
                    await saveTextAsFile(action[1], textFilename);
                    console.log('Saved          %s', path.relative('', textFilename));
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

    const endTime = new Date();
    console.log('Run completed at %s. Time taken %f seconds.', endTime.toLocaleString(),
            (endTime.getTime() - startTime.getTime()) / 1000);
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
    const disallowedFilenameChars = /[\0-\x1F\x7F-\x9F*?&<>"`|':\\]/u;
    if (row === 0) {
        if (action[0] !== 'zip-name') {
            throw new Error('First link of the instructions script must give the zip-name. ' +
                action[0] + ' found');
        }
        if (action.length !== 2) {
            throw new Error('zip-name line should only say zip-name <filename>. ' +
                'The filename cannot contain spaces.');
        }
        if (disallowedFilenameChars.test(action[1])) {
            throw new Error('The zip name may only contains characters -, _, ., a-z, A-Z and 0-9.');
        }

    } else if (action[0] === 'cookies') {
        if (action.length !== 2) {
            throw new Error('cookies line should only say cookies <base64blob>.');
        }

    } else {
        if (action[0] !== 'save-file' && action[0] !== 'save-pdf' && action[0] !== 'save-text') {
            throw new Error('After the first line, the only recognised actions are save-file, save-pdf and save-text. ' +
                action[0] + ' found.');
        }
        if (action.length !== 4 || action[2] !== 'as') {
            throw new Error('save-file, save-pdf and save-text actions must be of the form ' +
                'save-file <URL/content> as <file/path/in/zip>. The URL/content and file path cannot contain spaces.' +
                ' Found ' + action.join(' '));
        }
        // Should be the same as Moodle's PARAM_FILE.
        // The bit at the start is \p{Control}, but Node does not seem to support that yet.
        // And we additionally disallow * and ? here.
        if (disallowedFilenameChars.test(action[3])) {
            throw new Error("The filename '" + action[3] + "' contains disallowed characters.");
        }
    }
}

async function saveUrlAsPdf(browser, url, filename, cookies) {
    const page = await browser.newPage();
    if (cookies) {
        const cookieObjects = parseCookies(cookies, url);
        for (let i = 0; i < cookieObjects.length; i++) {
            await page.setCookie(cookieObjects[i]);
        }
    }
    await page.goto(url, {timeout: 5 * 60 * 1000, waitUntil: 'networkidle0'});
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

async function saveTextAsFile(rawContent, filename) {
    await createPath(path.dirname(filename));
    return util.promisify(fs.writeFile)(filename, rawContent.replace(/_/g, ' '));
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

function deleteFolder(filepath) {
    fs.rmdirSync(filepath, {recursive : true});
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

function getFileSize(filepath) {
    return fs.statSync(filepath).size;
}

/**
 * Format bytes as human-readable text.
 *
 * @param bytes Number of bytes.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
function formatBytes(bytes, dp= 1) {
    const thresh = 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    let u = -1;
    const r = 10**dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


    return bytes.toFixed(dp) + ' ' + units[u];
}

function parseBytes(bytesString) {
    const units = {'B': 1, 'KB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024};

    const match = /(\d+)(B|KB|MB|GB)/i.exec(bytesString);
    if (!match || !units.hasOwnProperty(match[2].toUpperCase())) {
        throw new Error(bytesString + " is not a valid file size.");
    }

    return match[1] * units[match[2]];
}
