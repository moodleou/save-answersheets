# Save answersheets script

This NodeJS command-line application accompanies the
[Export attempts quiz report for Moodle](https://github.com/moodleou/moodle-quiz_answersheets).
It helps provide the bulk download feature by taking a file of instructions
from the report, and based on the steps in there downloading all the Review sheets
as PDF files, and any attachments to responses, and then putting them all in a Zip file.

The PDF generation uses the [Puppeteer](https://github.com/puppeteer/puppeteer) API to
control a headless Chromium. How to use this script is documented within the
Export attempts report. 

## For developers

This is a node application, so you need to have npm installed. (I recommend
doing that using [nvm](http://nvm.sh).)

### Installing and running locally

Standard node thing:

```
npm install
```

then you can do

```
node . instruction-file.txt 
```

to run it.

### Building an .exe

We build the exe version using `nexe`, so you need to have that installed.

```
npm install -g nexe
```

Then to build:

```
nexe save-answersheets.js
```

then you will have a `save-answersheets.exe` In order to distribute that
in a way that works, you need that file, and the whole `node_modules\puppeteer`
folder. I suggest zipping those together.
