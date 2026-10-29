const mongoose=require('mongoose');

const badgeSchema=new mongoose.Schema({
    externalId:{
        type:String,
        required:true
    },
    name:{
        type:String,
        required:true
    },
    badgeUrl:{
        type:String,
        required:true
    },
    imageUrl:{
        type:String,
        default:null
    }
});

badgeSchema.index({externalId:1},{unique:true,sparse:true});
badgeSchema.index({badgeUrl:1},{unique:true,sparse:true});

const Badge=mongoose.model('Badge',badgeSchema);
module.exports={Badge};