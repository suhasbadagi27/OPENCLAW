require("dotenv").config();

const { google } = require("googleapis");
const readline = require("readline");

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    "http://localhost:3000"
);

const scopes = [
    "https://www.googleapis.com/auth/calendar"
];

const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
});

console.log("\nOpen this URL in browser:\n");
console.log(url);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.question("\nPaste the code here: ", async (code) => {
    try {
        const { tokens } = await oauth2Client.getToken(code);

        console.log("\n===== TOKENS =====\n");
        console.log(tokens);

        console.log("\n===== REFRESH TOKEN =====\n");
        console.log(tokens.refresh_token);

        rl.close();
    } catch (err) {
        console.error("\nERROR:\n");
        console.error(err);
        rl.close();
    }
});