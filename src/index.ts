import { serve } from "@hono/node-server";
import { Hono } from "hono";
import "dotenv/config";
// import puppeteer, { Browser } from "puppeteer-core";
import puppeteer, { Browser } from "puppeteer";
import * as cheerio from "cheerio";
import TelegramBot from "node-telegram-bot-api";

let browserInstance: Browser | null = null;
let bot: TelegramBot | null = null;
let isInitializing = false;

const initializeBrowserInstance = async () => {
  if (isInitializing) return;
  isInitializing = true;
  if (!bot) {
    const botToken = process.env.BOT!;
    bot = new TelegramBot(botToken, {
      polling: false,
    });
  }
  try {
    if (browserInstance) {
      await browserInstance.close();
    }
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    console.log("Browser instance initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize browser instance:", error);
  } finally {
    isInitializing = false;
  }
};

initializeBrowserInstance();

const getBrowserInstance = async (): Promise<Browser | null> => {
  if (!browserInstance) {
    await initializeBrowserInstance();
    return browserInstance;
  }
  return browserInstance;
};

const app = new Hono();

app.get("/", async (c) => {
  return c.text("hello");
});

app.post("/telegram", async (c) => {
  try {
    const data = (await c.req.json()) as BotIncoming;
    const res = await handleIncoming(data);
    if (bot) {
      bot.sendMessage(
        res.chatId,
        res.attendance
          ? `Class attended: ${res.attendance.ratio}\nAttendance: ${res.attendance.percentage}`
          : res.message
      );
    }
    return c.text("", 200);
  } catch (e) {
    const data = (await c.req.json()) as BotIncoming;
    if (bot) {
      bot.sendMessage(data.message.chat.id, "Something went wrong");
      return c.text("", 200);
    }
    console.log(e);
  }
});

const port = 3000;
console.log(`Server is running on port ${port}`);
console.log(process.env.CHROMIUM_PATH);

serve({
  fetch: app.fetch,
  port,
});

async function getAttendance(userId: string, password: string = "GCET123") {
  const browser = await getBrowserInstance();
  if (!browser) return null;
  const page = await browser.newPage();
  await page.goto("https://gu.icloudems.com/corecampus/index.php", {
    waitUntil: "networkidle2",
  });
  console.log("on main page");
  await page.type("#useriid", userId);
  await page.type("#actlpass", password);
  await page.click("#psslogin");
  console.log("clicked login");
  await page.waitForNavigation({ waitUntil: "networkidle2" });
  console.log("on profile page");
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    const linkToClick = links.find(
      (link) =>
        link.getAttribute("href") ===
        "/corecampus/student/attendance/subwise_attendace_new.php"
    );
    if (!linkToClick) throw new Error("a href not found");
    if (linkToClick) {
      linkToClick.click();
    }
  });
  await page.waitForNavigation({ waitUntil: "networkidle2" });
  console.log("on attendace page");
  const content = await page.content();
  const $ = cheerio.load(content);
  const tbody = $("table tbody");
  const lastTr = tbody.find("tr").last();
  const percentageEl = lastTr.find("td").last();
  const percentage = percentageEl.text();
  const ratio = percentageEl.prev().text();
  console.log(percentage, ratio);
  return { percentage, ratio };
}

type Command = "ping" | "rollno" | "new" | null;
type BotIncoming = {
  message: {
    chat: { id: number; first_name: string };
    text: string;
  };
};
type BotOutgoing = Promise<{
  chatId: number;
  firstName: string;
  attendance: {
    percentage: string;
    ratio: string;
  } | null;
  message: string;
}>;
async function handleIncoming(data: BotIncoming): BotOutgoing {
  const getCommand = (text: string) => {
    if (text.startsWith("/ping")) return "ping";
    if (text.startsWith("/rollno")) return "rollno";
    if (text.startsWith("/new")) return "new";
    return null;
  };
  const command: Command = getCommand(data.message.text);
  if (command === "new") {
    const rollNo = data.message.text.slice(command.length + 1).trim();
    if (!rollNo)
      return {
        chatId: data.message.chat.id,
        firstName: data.message.chat.first_name,
        attendance: null,
        message: "No roll number given",
      };
    const res = await getAttendance(rollNo);
    if (!res) {
      return {
        chatId: data.message.chat.id,
        firstName: data.message.chat.first_name,
        attendance: null,
        message: "Check your roll number and try again",
      };
    }
    if (res) {
      return {
        chatId: data.message.chat.id,
        firstName: data.message.chat.first_name,
        attendance: res,
        message: "ok",
      };
    }
  }
  return {
    chatId: data.message.chat.id,
    firstName: data.message.chat.first_name,
    attendance: null,
    message: "Please check your message and try again.",
  };
}

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  if (browserInstance) {
    await browserInstance.close();
  }
  process.exit();
});
