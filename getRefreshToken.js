const { google } = require("googleapis");
const readline = require("readline");

const oauth2Client = new google.auth.OAuth2(
    "528424404243-0le5q1dpfmc06e90kggqbumpcndh96kj.apps.googleusercontent.co",
    "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",
    "http://localhost"
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

        console.log("\nYOUR REFRESH TOKEN:\n");
        console.log(tokens.refresh_token);

        rl.close();
    } catch (err) {
        console.error(err);
    }
});