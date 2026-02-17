
require("dotenv").config()
const express = require("express")
const app = express()
app.use(express.json())

app.get("/", (req,res)=>res.send("Backend Running"))

app.post("/api/topup",(req,res)=>{
  res.json({token:"MIDTRANS_SNAP_TOKEN_SAMPLE"})
})

app.listen(process.env.PORT || 3000)
