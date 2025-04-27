const path = require("path");
const fsPromises = require("fs/promises");
const Papa = require("papaparse");
const sharp = require("sharp");
const puppeteer = require("puppeteer");
const logUpdate = require("log-update");
const chalk = require("chalk");

const LOG_FILE_LIMIT = 10;

let elapsedTime = 0;

let latestFiles = [];
let totalCount = 0;
let doneCount = 0;

let timerID = 0;

async function GetUpdateData() {
    const oldData = await ReadCSV(`data-normal.csv`);
    const newData = await ReadCSV(`data-update.csv`);

    const image = [];
    const csv = [];

    const updateInfoList = [
        ["id", image],
        ["id", csv],
        ["hash", csv],
        ["version", csv],
        ["type", csv],
        ["rarity", image],
        ["card_name", image],
        ["idol_name", image]
    ];

    for (let item of newData) {
        for (let [key, list] of updateInfoList) {
            const oldItem = Find(oldData, "id", item.id);
            const listItem = Find(list, "id", item.id);

            if (
                listItem === undefined &&
                (oldItem === undefined || oldItem[key] !== item[key])
            ) {
                list.push(item);
            }
        }
    }

    return { image, csv, newData };
}

async function CreateTranslationCSV(data, prefix, name) {
    const directory = {
        produce: "images/content/idols/name/",
        support: "images/content/support_idols/name/"
    };

    console.log(chalk.blueBright(`Create ${name}.csv...`));

    await WriteCSV(
        name,
        data.map((item) => [
            `${directory[item.type]}${item.hash}_${item.id}.png`,
            `${prefix}${item.id}.png`,
            item.version
        ])
    );
}

async function GenerateImage(data, name, directory) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto(`file:${path.join(__dirname, "image.html")}`);
    await page.setViewport({ width: 480, height: 360, deviceScaleFactor: 2 });

    async function GetImage(item) {
        await page.evaluate((item) => {
            const rarity = ["n", "r", "sr", "ssr", "ur"];
            SetText(item.card_name, item.idol_name, rarity[item.rarity - 1]);
        }, item);

        const buffer = await page.screenshot({
            omitBackground: true,
            clip: { x: 0, y: 0, width: 444, height: 198 }
        });

        // Create image as 2x size, and resize it into 1x size.
        // I chose this way, because Puppeteer is create quite dirty image when I create 1x size image.
        // This way spend more time (about 10 ~ 20%) but create much better images :)
        await sharp(buffer).resize(444, 198).toFile(`${directory}/${name}${item.id}.png`);
    }

    for (let item of data) {
        const start = new Date();
        await GetImage(item);
        elapsedTime += new Date() - start;
        latestFiles.push(`${++doneCount}. [${item.card_name}] ${item.idol_name}`);
    }

    await browser.close();
}

function ProcessLog(mode) {
    return () => {
        const percent = totalCount === 0 ? 0 : doneCount / totalCount;
        const percentString = (percent * 100).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        logUpdate(
            [
                chalk.blueBright(`Mode: ${Capitalize(mode)}`),
                ...latestFiles.slice(-LOG_FILE_LIMIT),
                "",
                chalk.yellow(`Processing... (${doneCount}/${totalCount})`),
                chalk.yellowBright(`Estimate: ${GetEstimatedTime()}`),
                chalk.yellow(`${GetProgressBar(percent, 20)} ${percentString}%`),
                ""
            ].join("\n")
        );
    };
}

function StartLog(mode, total) {
    totalCount = total;
    latestFiles.length = LOG_FILE_LIMIT;
    latestFiles.fill("");
    timerID = setInterval(ProcessLog(mode), 16);
}

function EndLog() {
    clearInterval(timerID);
    logUpdate.done();
}

async function ReadCSV(file) {
    return Papa.parse(await fsPromises.readFile(file, { encoding: "utf8" }), {
        header: true,
        skipEmptyLines: true
    }).data;
}

async function WriteCSV(file, data) {
    await fsPromises.writeFile(`${file}.csv`, Papa.unparse(data));
}

async function MakeDirectory(directory) {
    try {
        await fsPromises.rm(`./${directory}`, { recursive: true, force: true });
        await fsPromises.mkdir(`./${directory}`);
    } catch (err) {
        if (err.code !== "EEXIST") throw err;
    }
}

function GetProgressBar(percentage, length) {
    const count = Math.floor(percentage * length);
    const result = [];
    for (let i = 0; i < length; i++) {
        if (i < count) {
            result.push("▶");
        } else {
            result.push("▷");
        }
    }
    return result.join("");
}

function GetEstimatedTime() {
    if (elapsedTime === 0 || doneCount === 0) {
        return "";
    } else {
        const average = elapsedTime / doneCount;
        const left = totalCount - doneCount;
        const estimate = Math.round((average * left) / 1000);
        return `${Math.floor(estimate / 60)}m ${estimate % 60}s`;
    }
}

function Find(array, key, value) {
    return array.filter((item) => item[key] === value)[0];
}

function Capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

(async function () {
    const mode = process.env.MODE;
    const setting = {
        normal: {
            prefix: "card_name_",
            directory: "result-normal",
            csvFileName: "image"
        },
        simple: {
            prefix: "",
            directory: "result-simple",
            csvFileName: ""
        },
        update: {
            prefix: "card_name_",
            directory: "result-update",
            csvFileName: "image-update"
        }
    }[mode];

    let csv, image, newData;

    switch (mode) {
        case "normal":
            image = csv = await ReadCSV(`data-normal.csv`);
            break;
        case "simple":
            image = await ReadCSV(`data-simple.csv`);
            break;
        case "update":
            ({ image, csv, newData } = await GetUpdateData());
            break;
        default:
            if (mode === undefined) {
                console.error(
                    chalk.bgRed(
                        "ERROR: You need to run this tool with 'npm run <command>'."
                    )
                );
            } else {
                console.error(chalk.bgRed(`ERROR: Unknown command "${mode}"`));
            }
            return;
    }

    if (image) {
        await MakeDirectory(setting.directory);

        StartLog(mode, image.length);
        await GenerateImage(image, setting.prefix, setting.directory);
        EndLog();
    }

    if (csv) {
        await CreateTranslationCSV(csv, setting.prefix, setting.csvFileName);
    }

    if (newData) {
        await WriteCSV("data-normal", newData);
    }

    console.log(chalk.green(`Complete! Check the '${setting.directory}' directory.`));
})();
