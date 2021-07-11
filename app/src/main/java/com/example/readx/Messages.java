package com.example.readx;

import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.Toast;

import com.example.readx.ui.Notes;
import com.parse.FindCallback;
import com.parse.Parse;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;

import org.w3c.dom.Document;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

public class Messages extends AppCompatActivity {

    ListView listView;
    ArrayAdapter<String> arrayAdapter;
    ArrayList<String> arrayList = new ArrayList<String>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_messages);
        listView = findViewById(R.id.listview);

        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId(getString(R.string.back4app_app_id))
                .clientKey(getString(R.string.back4app_client_key))
                .server(getString(R.string.back4app_server_url))
                .build()
        );
        ParseQuery<ParseObject> query = ParseQuery.getQuery("Messages");
        query.addDescendingOrder("time");
        query.findInBackground(new FindCallback<ParseObject>() {
            @RequiresApi(api = Build.VERSION_CODES.O)
            @Override
            public void done(List<ParseObject> objects, ParseException e) {
                if(e == null){
                    if(objects.size() > 0){
                        for(ParseObject object: objects){
                            String strr = object.get("time").toString();
//                            String str1 = strr.substring(0,9);
//                            String str2 = strr.substring(11,strr.length() - 4);
                            String str = strr.substring(0,strr.length() - 4);//str1 + " " + str2;
//                            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm::ss");
                            LocalDateTime dateTime = LocalDateTime.parse(str);
                            String times = dateTime.toString();
                            String time = times.substring(11,times.length()) + " " + times.substring(0,10);
                            String mess = "USER : " + object.get("username").toString().toLowerCase() + "\nNOTE : " + object.get("message").toString() + "\nTIME : " + time+"\nPAGE : " + String.valueOf(object.getInt("page")+"\n-------------------------");
//                            Notes notes = new Notes(object.get("username").toString(),object.get("message").toString(), dateTime,object.getInt("page"));
                            arrayList.add(mess);
                        }
                        arrayAdapter = new ArrayAdapter<String>(getApplicationContext(), android.R.layout.simple_list_item_1, arrayList);
                        listView.setAdapter(arrayAdapter);
                    }
                }
                else{
                    e.printStackTrace();
                }
            }
        });




    }
}