const mongoose=require('mongoose');


const badgeSchema=new mongoose.Schema({
    name:{
        type:String,
        required:true,
        unique:true
    },
    imageUrl:{
        type:String,
        required:true,
        unique:true
    }
});

badgeSchema.index(
    {name:1},
    {unique:true}
)

const Badge=mongoose.model('Badge',badgeSchema);
module.exports={Badge};