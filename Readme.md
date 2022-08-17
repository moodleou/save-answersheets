# Save answersheets script

This NodeJS command-line application accompanies the
[Export attempts quiz report for Moodle](https://github.com/moodleou/moodle-quiz_answersheets).
It helps provide the bulk download feature by taking a file of instructions
from the report, and based on the steps in there downloading all the Review sheets
as PDF files, and any attachments to responses, and then putting them all in a Zip file.

The PDF generation uses the [Puppeteer](https://github.com/puppeteer/puppeteer) API to
control a headless Chromium. How to use this script is documented within the
Export attempts report. 


## Using this script

This script is implemented in Node JS, so it takes a bit of effort to get it running,
but if you are familiar with Node, then actually, this is all pretty standard. The
following steps were verified in Windows 10. Similar steps will work on Mac and Linux.

1. Download and install Node from using https://github.com/coreybutler/nvm-windows (or https://github.com/nvm-sh/nvm for Mac/Linux).
2. Once installed, open PowerShell as an administrator and navigate to the NVM folder. (Use a terminal window on Mac/Linux)
3. Input `nvm install 16.16.0`.
4. Input `nvm use 16.16.0`. (If you don’t have administrator permissions, this step will fail on Windows).
5. Download the saveanswersheet code from https://github.com/moodleou/save-answersheets/archive/refs/heads/main.zip
   and unzip it on your Windows desktop (or get it another way, for example using `git`).
6. Navigate the directory (`cd`) to get to the ‘save-answersheet’ folder.
7. Input `npm install` (this may take a while).
8. In your web browser, navigate to the quiz you wish to export from.
9. In the quiz settings, choose ‘Results’ and then ‘Export attempts’.
10. You should have the 'Download review sheets in bulk' link at the bottom of the user data table. Click on it.
    (This link only shows to roles with the right capability, so if it is not appearing, check you role definitions.)
11. This gives you the bulk download steps text file. Warning: this also includes your current sign-in information
    for your Moodle install, so thoroughly delete it after you have completed extraction.
12. Place the steps file in the ‘save-answersheets’ folder.
13. Ensure that you are still in the folder in Node.js that has the saveanswersheet files and instructional steps text file.
14. Input `node . instruction-file.txt`, where ‘instruction-file.txt’ is the name of the steps file you just downloaded.
15. The completed answer sheets will download as files in the new ‘Output’ subfolder.


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

To only download data for one user, you can do

```
node . --download-only X1234567 instruction-file.txt
```

### Building an .exe

Remember to update the version number in showVersionAndExit before building.

We build the exe version using `nexe`, so you need to have that installed. Finding a version that works
can be tricky, but node 14.15.3 currently does.

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
