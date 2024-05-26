import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.models.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken"
import mongoose from "mongoose";

//this is so common so we gonna create a method for this 
const generateAccessAndRefreshTokens= async(userId) =>{
    try{
        const user= await User.findById(userId)
        const accessToken=await  user.generateAccessToken()
        const refreshToken=await user.generateRefreshToken()
        //access token we will give to user but we need to save refresh tokens to database
        user.refreshToken= refreshToken
        await user.save({validateBeforeSave: false})      //mongoose will kick in too many methods for save thats why we need to tell validateBeforeSave as false

        return {accessToken , refreshToken}
    }catch(error){
        throw new ApiError(500,"Something went wrong while generating access and refresh tokens")
    }
}


//method to register user
const registerUser= asyncHandler( async (req,res) =>{
    // 1.get user details from frontend -> frontend means data from postman 
    // 2.validation - not empty
    // 3.check if user already exists : check via username or email
    // 4.check for images , check for avatar
    // 5.upload them on cloudinary, avatar
    // 6.create user object - create entry in db
    // 7.remove password and refresh token field from response
    // 8.check for user creation 
    // 9.return response

    //1.Get user details from frontend
    const {fullname,email,username,password}=req.body  //If data is coming from form or json then u will get through , for url we will see later
    // console.log("email: ",email);
    
    //2.Validation
    if(
        [fullname,email,username,password].some((field)=> field?.trim()==="")       //some accepts two or three arguments return the value when it is true or until the end of the array
        
        // The array [fullname, email, username, password] contains four fields that you likely want to validate.
        // The .some() method iterates over this array, applying the arrow function (field) => field?.trim() == "" to each element.
        // For each field in the array:
        // field?.trim() is called. If field is null or undefined, the optional chaining operator (?.) ensures that undefined is returned instead of causing an error.
        // The trim() method removes any leading or trailing whitespace from the field.
        // The result of trim() is compared to an empty string ("").
        // If any field in the array, after trimming, is an empty string, the condition field?.trim() == "" will be true for that field.
        // The .some() method will then return true if at least one field satisfies the condition. Otherwise, it will return false.
    ){
        throw new ApiError(400,"All fields are required")
    }


    //3.check if user already exists
    const existedUser=await User.findOne({
        $or: [{ username },{ email }]          //operators is getting introduced here, we can invoke them using $
    })
    
    if(existedUser){
        throw new ApiError(409,"User with email and username already exists")  //Direct create a object from ApiError and pass attributes to it thats why we created this ApiError in utils to minimise our task
    }
    console.log(req.files);

    //4.checks for images, checks for avatar

    //file ka naam avatar hai check in user.routes
    // const avatarLocalPath= req.files?.avatar[0]?.path;  //multer gives access to the files //avatar[0] k pass property hai path ki which will tell the path, gives the original name
    // const coverImageLocalPath=req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }
    let avatarLocalPath;
    if (req.files && Array.isArray(req.files.avatar) && req.files.avatar.length > 0) {
        avatarLocalPath = req.files.avatar[0].path
    }
    // if(!avatarLocalPath){
    //     throw new ApiError(400,"Avatar file is required");
    // }

    //5.upload on clodinary ,avatar
    const avatar= await uploadOnCloudinary(avatarLocalPath)  //this step will take time ,thats why we had put aysnc in starting async(req,res)
    const coverImage= await uploadOnCloudinary(coverImageLocalPath)
    //again check for avatar
    if(!avatar){
        throw new ApiError(400,"Avatar file not uploaded on Cloudinary");
    }

    //6.create user object - create db in user
    const user= await User.create({
        fullname,
        avatar: avatar.url,         //I want that only url of the object should be saved in db instead of whole object data
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    //7.remove password and refresh tokens
    //MongoDb implicitely define an id(_id field) along with ur data entries
    const createdUser= await User.findById(user._id).select(    //Find user through id if found user is successfully created otherwise not
        "-password -refreshToken"           //we can remove password and refresh token with objects but here we can do it easily with chaining
    )       //weird syntax
    
    //8.check for user creation
    if(!createdUser){
        throw new ApiError(500,"Something went wrong while registering the user");
    }

    //9.return response
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully")
    )

})



const loginUser = asyncHandler(async (req,res) =>{
    // 1.req body-> data
    // 2.username or email
    // 3.find the user
    // 4.password check
    // 5.access and refresh token
    // 6.send them in cookies
    
    // 1.req body se data lena hai
    const {email,username,password}=req.body
    console.log(email);

    // 2.username or email me se koi ek to hona hi chahie
    if(!username && !email){
        throw new ApiError(400,"Username or email is required")
    }

    //3. find the user
    const user=await User.findOne({                      //findOne in mongoDb returns the data whichever it will find first
        $or: [{username},{email}]         //these are mongodb operators which will data on the basis of username or email
    })    

    if(!user){
        throw new ApiError(404,"User does not exist")
    }

    // 4.user found now check password      
    const isPasswordValid = await user.isPasswordCorrect(password)               //we are not writing user 'u' in capital because we create it as capital when it is mongoDb object but it is created by us not by mongoDb

    if(!isPasswordValid){
        throw new ApiError(401,"Invalid user cridentials")
    }

    // 5.access and refresh tokens
    
    const {accessToken,refreshToken}= await generateAccessAndRefreshTokens(user._id)

    // I created a user but user refreshToken is empty coz I created user first then called the function for user so I have to again configure the user with refreshToken
    // Now I can again call the database query or can update the user, if database query is a expensive operation then prefer updating the user
    const loggedInUser=await User.findById(user._id).select("-password -refreshToken")   // .select will remove the fields that I dont want

    // 6.send them in cookies

    // By default cookies can be modified by anyone in frontend but if you true the httpOnly and secure field then it can only be modifiable by server 
    const options = {
        httpOnly: true,
        secure: true
    }

    // 7.return response
    return res
    .status(200)
    .cookie("accessToken",accessToken,options)
    .cookie("refreshToken",refreshToken,options)
    .json(
        new ApiResponse(200,
            {
                user: loggedInUser,accessToken,refreshToken //We had previosly set accessToken and refreshToken but again we are sending it because here we are handling the case where user want to save the tokens by himself, maybe possible he want to save it in localstrage maybe he is developing a mob app where cookies are not set 
            },
            "User logged in successfully"
        )
    )

})

const logoutUser = asyncHandler(async(req,res) => {
    //I have to logout some user, for that I have t get the user info that I have to logout
    //But previuosly I was getting it through req.body and some fields but here we dont know which email to logout
    //thats why we have to use middlewares
    // 1.find the user
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset : {
                refreshToken: 1 //this removes the field from the document
            }
        },
        {
            new : true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged Out"))
})


export {registerUser,loginUser,logoutUser, }