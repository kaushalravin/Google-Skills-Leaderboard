const mongoose=require('mongoose');
const {User}=require('./users');
const {Badge}=require('./badges');

const userBadgeSchema=new mongoose.Schema({
    user:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User'
        required:true
    },
    badge:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Badge'
        required:true
    },
    earnedAt:{
        type:Date,
        required:true
    }

});

userBadgeSchema.index(
  { userId: 1, badgeId: 1 },
  { unique: true }
);

const UserBadge=mongoose.model('UserBadge',userBadgeSchema);
module.exports={UserBadge};