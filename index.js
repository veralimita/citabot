const Tesseract = require('tesseract.js');
const TelegramBot = require('node-telegram-bot-api');
const readline = require('readline');
const cron = require('node-cron');
const _config = require('./config.json');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();

const adminChatId = 138196779;

const puppeteer = require('puppeteer');
let registeringIsEnabled = false;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});


function recognizeTextFromImage(imagePath) {
    return new Promise((resolve, reject) => {
        Tesseract.recognize(
            imagePath,
            'eng', // Language
        ).then(({ data: { text } }) => {
            resolve(text); // Resolve the promise with the recognized text
        }).catch(error => {
            reject(error); // Reject the promise if there's an error
        });
    });
}

const token = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(token, { polling: true });

const getPromiseWithUserInput = (question) => {
    return new Promise((resolve, reject) => {
        rl.question(question, (userInput) => {
            resolve(userInput);
        });
    });
}

function sendImageAndWaitForInput(chatId, imageSource, caption, code) {
    return new Promise((resolve, reject) => {
        let userInputReceived = false;

        const timeout = setTimeout(() => {
            if (!userInputReceived) {
                console.log(chatId, '❗️ No user input received within 30 seconds. Aborting... ❗️');
                reject(new Error('❗️ No user input received within 30 seconds. Aborting... ❗️'));
            }
        }, 30000);

        bot.sendPhoto(chatId, imageSource, {
            caption: caption + ' recognized code: ' + code,
        }).then(() => {
            bot.once('message', (responseMsg) => {
                const userInput = responseMsg.text;
                userInputReceived = true;
                clearTimeout(timeout);
                resolve(userInput);
            });
        }).catch((error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

bot.onText(/\/check/, (msg) => {
    const chatId = msg.chat.id;
    check({[chatId]: _config[chatId]}).catch(console.error);
});

bot.onText(/\/register/, (msg) => {
    const chatId = msg.chat.id;
    if (!registeringIsEnabled) {
        bot.sendMessage(chatId, 'Registering is disabled').catch(console.error);
        return;
    }
    try {
        const url = msg.text.split(' ')[1];
        _config[chatId] = url;
        fs.writeFileSync('./config.json', JSON.stringify(_config));
        bot.sendMessage(chatId, 'Registered url: ' + url)
    } catch (e) {
        bot.sendMessage(chatId, 'Error registering url: ' + e.toString()).catch(console.error);
    }
});

bot.onText(/\/enableRegistering/, (msg) => {
    if (msg.chat.id === adminChatId) {
        registeringIsEnabled = true;
        bot.sendMessage(msg.chat.id, 'Registering is enabled').catch(console.error);
    }
});

bot.onText(/\/disableRegistering/, (msg) => {
    if (msg.chat.id === adminChatId) {
        registeringIsEnabled = false;
        bot.sendMessage(msg.chat.id, 'Registering is disabled').catch(console.error);
    }
});

bot.onText(/\/list/, (msg) => {
    if (msg.chat.id === adminChatId) {
        const chatIds = Object.keys(_config);
        const message = chatIds.map((chatId) => {
            return `${chatId}: ${_config[chatId]} ${chatId === `${msg.chat.id}` ? '👈' : ''}`;
        }).join('\n');
        bot.sendMessage(msg.chat.id, message).catch(console.error);
    }
});

bot.onText(/\/remove/, (msg) => {
    if (msg.chat.id === adminChatId) {
        const chatId = msg.text.split(' ')[1];
        delete _config[chatId];
        fs.writeFileSync('./config.json', JSON.stringify(_config));
        bot.sendMessage(msg.chat.id, 'Removed chatId: ' + chatId).catch(console.error);
    } else {
        const chatId = msg.chat.id;
        delete _config[chatId];
        fs.writeFileSync('./config.json', JSON.stringify(_config));
        bot.sendMessage(msg.chat.id, 'Removed link').catch(console.error);
    }
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `/check - check url
/register <url> - register url
/remove - remove url for current chat
/enableRegistering - enable registering (only for admin)
/disableRegistering - disable registering (only for admin)
/list - list all registered urls (only for admin)
/remove <chatId> - remove url for chatId (only for admin)
/help - show help`).catch(console.error);
});

const check = async (config) => {
    for (let chatId in config) {
        try {
            const browser = await puppeteer.launch({
                args: ['--no-sandbox'],
                headless: true,
            });
            const page = await browser.newPage();

            // Navigate to the web page
            const url = config[chatId];
            await page.goto(url);

            // Wait for the element with the specific selector to be visible
            const selector = '.inp img';
            await page.waitForSelector(selector);

            // Get the bounding box of the element
            const element = await page.$(selector);
            const boundingBox = await element.boundingBox();
            if (!boundingBox) {
                throw new Error('No bounding box found for the specified element.');
            } else {
                await page.screenshot({
                    path: 'screenshot.png',
                    clip: boundingBox,
                });
                const recognizedCode = await recognizeTextFromImage('./screenshot.png');
                const userInput = await sendImageAndWaitForInput(chatId, './screenshot.png', 'Please enter the text in the image:', recognizedCode);
                rl.close();

                await page.type('input#ctl00_MainContent_txtCode', userInput);
                await page.screenshot({path: 'input.png'});
                await page.click('input#ctl00_MainContent_ButtonA');
                await page.waitForSelector('input#ctl00_MainContent_ButtonB');
                await page.click('input#ctl00_MainContent_ButtonB');
                await page.waitForSelector('input#ctl00_MainContent_Button1');
                await page.screenshot({path: 'calendar.png'});
                await browser.close();

                await bot.sendPhoto(chatId, './calendar.png', {
                    caption: `Calendar for ${url}`,
                })
            }
        } catch (e) {
            bot.sendMessage(chatId, e.toString()).catch(console.error);
        }
    }
};

cron.schedule('0 * * * *', ()=>{check(_config)});