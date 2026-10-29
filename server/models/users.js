const mongoose=require('mongoose');

const userSchema=new mongoose.Schema({
    username:{
        type:String,
        required:true,
    },
    email:{
        type:String,
        required:true,
        unique:true
    },
    skillsEmail:{
        type:String,
        required:true,
        unique:true
    },
    skillsUrl:{
        type:String,
        required:true,
        unique:true
    },
    badgeCount:{
        type:Number,
        default:0,
        min:0
    }
});

userSchema.index(
    {skillsUrl:1},
    {unique:true}
);


const User=mongoose.model('User',userSchema);
module.exports={User};