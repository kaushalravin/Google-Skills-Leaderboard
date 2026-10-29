const mongoose=require('mongoose');
const express=require('express');
const path = require('path');

const {scrape}=require('./scraper/webScraper');
const {test}=require('./scraper/test');
const {Badge}=require('./models/badges');


require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const port=process.env.PORT||3000;
const mongoUrl=process.env.MONGO_URI;

const app=express();

mongoose
  .connect(mongoUrl)
  .then(() => {
    return Badge.syncIndexes();
  })
  .then(() => {
    console.log("MongoDB connection successful!");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

app.get('/',async(req,res)=>{
    await scrape();
    res.json({
        success:true,
        msg:"successfully listening at port "+port
    })
})


app.listen(port,()=>{
    console.log("the server is listening at port "+port);
})