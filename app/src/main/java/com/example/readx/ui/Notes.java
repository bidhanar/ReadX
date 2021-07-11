package com.example.readx.ui;


import android.os.Build;

import androidx.annotation.RequiresApi;

import java.io.Serializable;
import java.time.LocalDateTime;

public class Notes implements Serializable {

    String username;
    String message;
    LocalDateTime time;
    int page;


    @RequiresApi(api = Build.VERSION_CODES.O)
    public Notes(String username, String message, LocalDateTime time, int page){
        this.username = username;
        this.message = message;
        this.time = time;
        this.page = page;
    }

    public String getUsername() {
        return username;
    }

    public String getMessage() {
        return message;
    }

    public LocalDateTime getTime() {
        return time;
    }

    public int getPage() {
        return page;
    }
}
