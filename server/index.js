const mongoose=require('mongoose');
const express=require('express');
const path = require('path');


require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const port=process.env.PORT||3000;

const app=express();

app.get('/',(req,res)=>{
    res.json({
        success:true,
        msg:"successfully listening at port "+port
    })
})


app.listen(port,()=>{
    console.log("the server is listening at port "+port);
})