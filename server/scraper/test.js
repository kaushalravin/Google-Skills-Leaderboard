const axios=require('axios');
const {scrapeProfile}=require('./webScraper');
const {User}=require('../models/users')

async function test(){
    const testUser = await User.findOne({ skillsUrl: { $exists: true, $ne: "" } });

console.log("Testing:", testUser?.skillsUrl);

if (testUser) {
    try {
        const badges = await scrapeProfile(testUser.skillsUrl);
        console.log("Success! Badges:", badges.length);
        console.log(badges.slice(0, 2));
    } catch (error) {
        console.log("Status:", error.response?.status);
        console.log("Response:", String(error.response?.data).slice(0, 500));
    }
}

return;
}

module.exports={test};