const express = require('express');
const cors = require('cors');

let app = express();
app.use(cors());

// add routes here


app.listen(3000, ()=>{
    console.log("Server started")
})

app.get('/', function(req,res){
    res.json({
       "message":"hello world"
    });
})

app.get('/hello/:name', (req,res)=>{
  let name = req.params.name;
  res.send("Hi, " + name);
})

app.get('/echo', (req, res) => {
    // Get all query parameters
    const queryParams = req.query;

    // Create a response object
    const response = {
        message: "Here are the query parameters you sent:",
        firstName: queryParams.firstName,
        lastName: queryParams.lastName
    };

    // Send the response as JSON
    res.json(response);
});

app.get('/echo', (req, res) => {
    // Get all query parameters
    const queryParams = req.query;

    // Create a response object
    const response = {
        message: "Here are the query parameters you sent:",
        firstName: queryParams.firstName,
        lastName: queryParams.lastName
    };

    // Send the response as JSON
    res.json(response);
});

